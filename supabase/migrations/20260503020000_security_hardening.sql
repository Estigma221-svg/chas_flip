-- ChasFlip · Security hardening (FASE 1)
-- ===========================================================================
-- Idempotente: usa CREATE OR REPLACE / DROP IF EXISTS / IF NOT EXISTS.
-- Cubre los 6 hardenings backend de la FASE 1:
--   #1 rate limit chat
--   #2 forzar user_name/avatar/pais_code desde profiles (anti-suplantación)
--   #3 forzar badge_earnings desde user_stats (anti-engaño)
--   #5 rate limit matchmaking
--   #6 audit_log + write_audit() integrado en RPCs críticos
--   #7 (lado server) errores de RPC con mensajes estables y sin filtrar internals

-- ===========================================================================
-- A) Auditoría — tabla append-only
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.audit_log (
  id          bigserial PRIMARY KEY,
  user_id     uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  action      text NOT NULL,
  target_id   text,
  meta        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_user_created_idx
  ON public.audit_log (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_log_action_created_idx
  ON public.audit_log (action, created_at DESC);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- Nadie puede leer/escribir directo desde el cliente. Solo `service_role` y
-- las RPCs `SECURITY DEFINER` escriben mediante write_audit().
DROP POLICY IF EXISTS "audit_log_no_client_access" ON public.audit_log;
CREATE POLICY "audit_log_no_client_access" ON public.audit_log
  FOR ALL TO authenticated, anon USING (false) WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.write_audit(
  p_action     text,
  p_target_id  text DEFAULT NULL,
  p_meta       jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.audit_log (user_id, action, target_id, meta)
  VALUES (auth.uid(), p_action, p_target_id, COALESCE(p_meta, '{}'::jsonb));
EXCEPTION WHEN OTHERS THEN
  -- Auditoría nunca debe romper la operación principal; tragamos errores.
  NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.write_audit(text, text, jsonb) FROM PUBLIC;
-- Solo SECURITY DEFINER la usan las RPCs; el cliente NO la puede llamar.
REVOKE EXECUTE ON FUNCTION public.write_audit(text, text, jsonb) FROM authenticated, anon;

-- ===========================================================================
-- B) Chat: anti-suplantación + anti-engaño + rate limit
-- ===========================================================================
-- Trigger BEFORE INSERT que:
--   * Verifica que el user_id coincida con auth.uid() (RLS también lo hace,
--     pero defensa-en-profundidad).
--   * Reescribe user_name/avatar/pais_code desde public.profiles.
--   * Recalcula badge_earnings desde public.user_stats.
--   * Hace rate limit: max 5 mensajes / 60s por usuario.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.messages_enforce_server_truth()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_email     text;
  v_avatar    text;
  v_pais      text;
  v_won       numeric;
  v_lost      numeric;
  v_recent    integer;
  CHAT_RL_MAX     constant integer := 5;
  CHAT_RL_WINDOW  constant interval := '60 seconds';
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  -- Anti-suplantación: el user_id real lo dicta auth.uid(), no el cliente.
  NEW.user_id := v_uid;

  -- Rate limit por usuario, ventana móvil de 60s.
  SELECT count(*) INTO v_recent
  FROM public.messages
  WHERE user_id = v_uid
    AND created_at > now() - CHAT_RL_WINDOW;

  IF v_recent >= CHAT_RL_MAX THEN
    RAISE EXCEPTION 'chat_rate_limited' USING ERRCODE = 'P0001';
  END IF;

  -- user_name, avatar y pais_code los manda el server desde profiles.
  SELECT COALESCE(p.email, ''),
         COALESCE(NULLIF(btrim(p.avatar), ''), ''),
         COALESCE(NULLIF(btrim(p.pais_code), ''), 'XX')
    INTO v_email, v_avatar, v_pais
  FROM public.profiles p
  WHERE p.id = v_uid;

  -- Si el user no tiene perfil aún, igual aceptamos pero con defaults.
  NEW.user_name := COALESCE(NULLIF(btrim(v_email), ''), '@anon');
  NEW.avatar    := COALESCE(v_avatar, '');
  NEW.pais_code := COALESCE(v_pais, 'XX');

  -- badge_earnings: lo calcula el server, no el cliente.
  SELECT COALESCE(total_won, 0), COALESCE(total_lost, 0)
    INTO v_won, v_lost
  FROM public.user_stats
  WHERE user_id = v_uid;

  NEW.badge_earnings := COALESCE(v_won, 0) - COALESCE(v_lost, 0);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS messages_enforce_server_truth_trg ON public.messages;
CREATE TRIGGER messages_enforce_server_truth_trg
  BEFORE INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.messages_enforce_server_truth();

-- Ya no permitimos UPDATE/DELETE de mensajes desde el cliente.
DROP POLICY IF EXISTS "messages_no_update_client" ON public.messages;
CREATE POLICY "messages_no_update_client" ON public.messages
  FOR UPDATE TO authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "messages_no_delete_client" ON public.messages;
CREATE POLICY "messages_no_delete_client" ON public.messages
  FOR DELETE TO authenticated USING (false);

-- ===========================================================================
-- C) Matchmaking rate limit (3 joins / 30s)
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.match_queue_rate_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_recent    integer;
  MM_RL_MAX     constant integer := 3;
  MM_RL_WINDOW  constant interval := '30 seconds';
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  -- Cuenta joins (cualquier estado) en la ventana móvil.
  SELECT count(*) INTO v_recent
  FROM public.match_queue
  WHERE user_id = v_uid
    AND created_at > now() - MM_RL_WINDOW;

  IF v_recent >= MM_RL_MAX THEN
    RAISE EXCEPTION 'matchmaking_rate_limited' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS match_queue_rate_limit_trg ON public.match_queue;
CREATE TRIGGER match_queue_rate_limit_trg
  BEFORE INSERT ON public.match_queue
  FOR EACH ROW
  EXECUTE FUNCTION public.match_queue_rate_limit();

-- ===========================================================================
-- D) Hooks de auditoría dentro de las RPCs críticas
--    (matchmaking_join, cancel_matchmaking, resolve_match_round)
--    Mantenemos la lógica idéntica y solo añadimos write_audit() en pasos clave.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.matchmaking_join(p_stake_amount integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_commission numeric(12, 10);
  v_opp uuid;
  v_opp_avatar text;
  v_opp_pais text;
  v_opp_email text;
  v_join_avatar text;
  v_join_pais text;
  v_join_email text;
  v_match_id uuid;
  v_queue_id uuid;
  v_meta jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;

  v_commission := public.commission_for_stake(p_stake_amount);
  IF v_commission IS NULL THEN
    PERFORM public.write_audit('matchmaking_join_invalid_stake', NULL,
      jsonb_build_object('stake_amount', p_stake_amount));
    RAISE EXCEPTION 'invalid_stake_tier' USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM public.match_queue mq
  WHERE mq.user_id = v_uid AND mq.status = 'waiting';

  SELECT q.user_id INTO v_opp
  FROM public.match_queue AS q
  WHERE q.status = 'waiting'
    AND q.stake_amount = p_stake_amount
    AND q.user_id <> v_uid
  ORDER BY q.created_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF v_opp IS NOT NULL THEN
    SELECT p.avatar, p.pais_code, p.email INTO v_opp_avatar, v_opp_pais, v_opp_email
    FROM public.profiles AS p WHERE p.id = v_opp;

    SELECT p.avatar, p.pais_code, p.email INTO v_join_avatar, v_join_pais, v_join_email
    FROM public.profiles AS p WHERE p.id = v_uid;

    v_meta := jsonb_build_object(
      'player_one_sees', jsonb_build_object(
        'avatar', COALESCE(v_join_avatar, ''),
        'pais_code', COALESCE(v_join_pais, 'XX'),
        'email', v_join_email
      ),
      'player_two_sees', jsonb_build_object(
        'avatar', COALESCE(v_opp_avatar, ''),
        'pais_code', COALESCE(v_opp_pais, 'XX'),
        'email', v_opp_email
      )
    );

    INSERT INTO public.matches (
      player_one_id, player_two_id, stake_amount, commission_decimal, status, meta
    ) VALUES (
      v_opp, v_uid, p_stake_amount, v_commission, 'in_progress', v_meta
    )
    RETURNING id INTO v_match_id;

    DELETE FROM public.match_queue mq
    WHERE mq.user_id = v_opp AND mq.status = 'waiting';

    PERFORM public.write_audit('match_paired', v_match_id::text,
      jsonb_build_object(
        'stake_amount', p_stake_amount,
        'commission_decimal', v_commission,
        'opponent_id', v_opp
      ));

    RETURN jsonb_build_object(
      'matched', true,
      'match_id', v_match_id,
      'stake_amount', p_stake_amount,
      'commission_decimal', v_commission,
      'opponent', jsonb_build_object(
        'avatar', COALESCE(v_opp_avatar, ''),
        'pais_code', COALESCE(v_opp_pais, 'XX'),
        'email', v_opp_email
      )
    );
  END IF;

  INSERT INTO public.match_queue (user_id, stake_amount, commission_decimal, status)
  VALUES (v_uid, p_stake_amount, v_commission, 'waiting')
  RETURNING id INTO v_queue_id;

  PERFORM public.write_audit('match_queued', v_queue_id::text,
    jsonb_build_object('stake_amount', p_stake_amount));

  RETURN jsonb_build_object(
    'matched', false,
    'queue_id', v_queue_id,
    'stake_amount', p_stake_amount,
    'commission_decimal', v_commission
  );
END;
$$;

REVOKE ALL ON FUNCTION public.matchmaking_join(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.matchmaking_join(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.matchmaking_join(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.cancel_matchmaking()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_deleted integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;
  WITH d AS (
    DELETE FROM public.match_queue mq
    WHERE mq.user_id = v_uid AND mq.status = 'waiting'
    RETURNING 1
  ) SELECT count(*) INTO v_deleted FROM d;

  PERFORM public.write_audit('match_cancel', NULL,
    jsonb_build_object('deleted_rows', v_deleted));

  RETURN jsonb_build_object('ok', true, 'deleted', v_deleted);
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_matchmaking() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_matchmaking() TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_matchmaking() TO service_role;

CREATE OR REPLACE FUNCTION public.resolve_match_round(p_match_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  m public.matches%ROWTYPE;
  v_winner uuid;
  v_won boolean;
  v_payout numeric;
  v_pay_all numeric;
  v_fee_total numeric;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;

  SELECT * INTO m FROM public.matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'match_not_found' USING ERRCODE = 'P0001'; END IF;

  IF v_uid <> m.player_one_id AND v_uid <> m.player_two_id THEN
    PERFORM public.write_audit('match_resolve_forbidden', p_match_id::text, '{}'::jsonb);
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF m.status = 'completed' AND m.winner_user_id IS NOT NULL THEN
    v_won := (m.winner_user_id = v_uid);
    v_pay_all := COALESCE(m.payout_winner_numeric,
      (2::numeric * m.stake_amount::numeric * (1::numeric - m.commission_decimal)));
    v_fee_total := COALESCE(m.protocol_fee_total,
      (2::numeric * m.stake_amount::numeric * m.commission_decimal));
    v_payout := CASE WHEN v_won THEN v_pay_all ELSE 0::numeric END;
    RETURN jsonb_build_object(
      'won', v_won, 'payout', v_payout, 'winner_id', m.winner_user_id,
      'commission_decimal', m.commission_decimal, 'stake_amount', m.stake_amount,
      'match_id', p_match_id, 'already_resolved', true,
      'payout_winner_numeric', v_pay_all, 'protocol_fee_total', v_fee_total
    );
  END IF;

  IF m.status <> 'in_progress' THEN RAISE EXCEPTION 'match_not_in_progress' USING ERRCODE = 'P0001'; END IF;

  -- TODO[fase2]: reemplazar random() por VRF criptográfico (Chainlink VRF) cuando haya dinero real.
  v_winner := CASE WHEN random() < 0.5 THEN m.player_one_id ELSE m.player_two_id END;
  v_won := (v_winner = v_uid);
  v_pay_all := 2::numeric * m.stake_amount::numeric * (1::numeric - m.commission_decimal);
  v_fee_total := 2::numeric * m.stake_amount::numeric * m.commission_decimal;
  v_payout := CASE WHEN v_won THEN v_pay_all ELSE 0::numeric END;

  UPDATE public.matches AS x
  SET winner_user_id = v_winner, status = 'completed', completed_at = now(),
      payout_winner_numeric = v_pay_all, protocol_fee_total = v_fee_total
  WHERE x.id = p_match_id;

  PERFORM public.write_audit('match_resolved', p_match_id::text,
    jsonb_build_object(
      'winner_id', v_winner,
      'stake_amount', m.stake_amount,
      'commission_decimal', m.commission_decimal,
      'payout_winner_numeric', v_pay_all,
      'protocol_fee_total', v_fee_total
    ));

  RETURN jsonb_build_object(
    'won', v_won, 'payout', v_payout, 'winner_id', v_winner,
    'commission_decimal', m.commission_decimal, 'stake_amount', m.stake_amount,
    'match_id', p_match_id, 'already_resolved', false,
    'payout_winner_numeric', v_pay_all, 'protocol_fee_total', v_fee_total
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_match_round(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_match_round(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_match_round(uuid) TO service_role;
