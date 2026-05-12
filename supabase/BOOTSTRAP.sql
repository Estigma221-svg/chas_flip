-- ChasFlip · BOOTSTRAP completo (idempotente)
-- Pega este archivo en Supabase Dashboard → SQL Editor → Run.
-- Equivale a aplicar TODAS las migraciones en `supabase/migrations/` en orden:
--   20260429120000_chasflip_matchmaking.sql
--   20260430104500_matches_payout_audit.sql
--   20260501123000_commissions_v2.sql
--   20260501142000_chat_messages.sql
--   20260501150000_user_stats.sql
--   20260501161500_messages_v2_columns.sql
--   20260503020000_security_hardening.sql
-- Es seguro re-ejecutarlo: usa IF NOT EXISTS / CREATE OR REPLACE / DROP POLICY IF EXISTS.

-- ===========================================================================
-- 1) Comisión autoritativa por tier
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.commission_for_stake(p_stake integer)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_stake
    WHEN 10 THEN 0.05
    WHEN 100 THEN 0.03
    WHEN 1000 THEN 0.02
    WHEN 10000 THEN 0.01
    WHEN 100000 THEN 0.005
    WHEN 1000000 THEN 0.003
    ELSE NULL
  END;
$$;

-- ===========================================================================
-- 2) Tabla `profiles`
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  email text,
  avatar text NOT NULL DEFAULT '',
  pais_code text NOT NULL DEFAULT 'XX',
  wallet_address text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.set_profiles_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS profiles_updated_at ON public.profiles;
CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_profiles_updated_at();

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_own"  ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_own"  ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_own"  ON public.profiles;

CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT TO authenticated USING (auth.uid() = id);

CREATE POLICY "profiles_insert_own" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- ===========================================================================
-- 3) Cola de matching y partidas
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.match_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  stake_amount integer NOT NULL,
  commission_decimal numeric(12, 10) NOT NULL,
  status text NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS match_queue_one_waiting_per_user
  ON public.match_queue (user_id) WHERE (status = 'waiting');

CREATE INDEX IF NOT EXISTS match_queue_waiting_stake_created
  ON public.match_queue (stake_amount, created_at) WHERE (status = 'waiting');

ALTER TABLE public.match_queue ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_one_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  player_two_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  stake_amount integer NOT NULL,
  commission_decimal numeric(12, 10) NOT NULL,
  winner_user_id uuid REFERENCES auth.users (id),
  status text NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'completed', 'cancelled')),
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT matches_distinct_players CHECK (player_one_id <> player_two_id)
);

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS payout_winner_numeric numeric(24, 10),
  ADD COLUMN IF NOT EXISTS protocol_fee_total numeric(24, 10);

CREATE INDEX IF NOT EXISTS matches_players_created
  ON public.matches (player_one_id, created_at DESC);

CREATE INDEX IF NOT EXISTS matches_player_two_created
  ON public.matches (player_two_id, created_at DESC);

ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "matches_select_participants" ON public.matches;
CREATE POLICY "matches_select_participants" ON public.matches
  FOR SELECT TO authenticated
  USING (auth.uid() = player_one_id OR auth.uid() = player_two_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                 WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='matches')
  THEN EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.matches'; END IF;
END $$;

-- ===========================================================================
-- 4) RPCs de matching y resolución
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
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  v_commission := public.commission_for_stake(p_stake_amount);
  IF v_commission IS NULL THEN RAISE EXCEPTION 'Invalid stake tier'; END IF;

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
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  DELETE FROM public.match_queue mq WHERE mq.user_id = v_uid AND mq.status = 'waiting';
  RETURN jsonb_build_object('ok', true);
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
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO m FROM public.matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Match not found'; END IF;

  IF v_uid <> m.player_one_id AND v_uid <> m.player_two_id THEN
    RAISE EXCEPTION 'Forbidden';
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

  IF m.status <> 'in_progress' THEN RAISE EXCEPTION 'Match not in progress'; END IF;

  v_winner := CASE WHEN random() < 0.5 THEN m.player_one_id ELSE m.player_two_id END;
  v_won := (v_winner = v_uid);
  v_pay_all := 2::numeric * m.stake_amount::numeric * (1::numeric - m.commission_decimal);
  v_fee_total := 2::numeric * m.stake_amount::numeric * m.commission_decimal;
  v_payout := CASE WHEN v_won THEN v_pay_all ELSE 0::numeric END;

  UPDATE public.matches AS x
  SET winner_user_id = v_winner, status = 'completed', completed_at = now(),
      payout_winner_numeric = v_pay_all, protocol_fee_total = v_fee_total
  WHERE x.id = p_match_id;

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

-- ===========================================================================
-- 5) Chat — tabla `messages` v2 (id, created_at, user_id, user_name, text, badge_earnings)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  user_name text NOT NULL DEFAULT '',
  text text NOT NULL DEFAULT '',
  badge_earnings numeric(24, 10) NOT NULL DEFAULT 0,
  avatar text NOT NULL DEFAULT '',
  pais_code text NOT NULL DEFAULT 'XX',
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='messages' AND column_name='email')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema='public' AND table_name='messages' AND column_name='user_name')
  THEN EXECUTE 'ALTER TABLE public.messages RENAME COLUMN email TO user_name'; END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='messages' AND column_name='body')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema='public' AND table_name='messages' AND column_name='text')
  THEN EXECUTE 'ALTER TABLE public.messages RENAME COLUMN body TO text'; END IF;
END $$;

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS user_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS text text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS badge_earnings numeric(24, 10) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avatar text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS pais_code text NOT NULL DEFAULT 'XX';

ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_body_len;
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_text_len;
ALTER TABLE public.messages
  ADD CONSTRAINT messages_text_len CHECK (char_length(btrim(text)) BETWEEN 1 AND 240);

CREATE INDEX IF NOT EXISTS messages_created_at_idx
  ON public.messages (created_at DESC);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "messages_select_authenticated" ON public.messages;
CREATE POLICY "messages_select_authenticated" ON public.messages
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "messages_insert_own" ON public.messages;
CREATE POLICY "messages_insert_own" ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id
              AND char_length(btrim(text)) BETWEEN 1 AND 240);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                 WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='messages')
  THEN EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.messages'; END IF;
END $$;

-- ===========================================================================
-- 6) Stats agregadas para badges del chat
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.user_stats (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  total_won numeric(24, 10) NOT NULL DEFAULT 0,
  total_lost numeric(24, 10) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_stats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_stats_select_authenticated" ON public.user_stats;
CREATE POLICY "user_stats_select_authenticated" ON public.user_stats
  FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.apply_match_to_user_stats()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_winner uuid := NEW.winner_user_id;
  v_loser  uuid;
  v_payout numeric := COALESCE(NEW.payout_winner_numeric, 0);
  v_stake  numeric := COALESCE(NEW.stake_amount, 0);
  v_won_delta numeric;
BEGIN
  IF NEW.status = 'completed'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'completed')
     AND v_winner IS NOT NULL
     AND v_winner IN (NEW.player_one_id, NEW.player_two_id) THEN

    v_loser := CASE WHEN v_winner = NEW.player_one_id
                    THEN NEW.player_two_id
                    ELSE NEW.player_one_id END;

    v_won_delta := GREATEST(v_payout - v_stake, 0);

    INSERT INTO public.user_stats(user_id, total_won)
      VALUES (v_winner, v_won_delta)
      ON CONFLICT (user_id) DO UPDATE
        SET total_won = public.user_stats.total_won + EXCLUDED.total_won,
            updated_at = now();

    INSERT INTO public.user_stats(user_id, total_lost)
      VALUES (v_loser, v_stake)
      ON CONFLICT (user_id) DO UPDATE
        SET total_lost = public.user_stats.total_lost + EXCLUDED.total_lost,
            updated_at = now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS matches_apply_user_stats ON public.matches;
CREATE TRIGGER matches_apply_user_stats
  AFTER INSERT OR UPDATE ON public.matches
  FOR EACH ROW
  EXECUTE FUNCTION public.apply_match_to_user_stats();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                 WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='user_stats')
  THEN EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.user_stats'; END IF;
END $$;
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


-- ===========================================================================
-- Anexado desde migrations/20260512100000_transactions_ledger.sql
-- (FASE 2.B.1 — ledger autoritativo `public.transactions`)
-- ===========================================================================
-- ChasFlip · Transactions ledger (FASE 2.B.1)
-- ===========================================================================
-- Crea el ledger autoritativo `public.transactions`:
--   * Tabla append-only con `balance_after` snapshot por fila (auditoria rapida).
--   * Idempotency key UUID UNIQUE por usuario (cliente lo genera con
--     crypto.randomUUID() para que reintentos no dupliquen movimientos).
--   * RLS estricto: SELECT solo del propio user_id; INSERT/UPDATE/DELETE
--     bloqueado al cliente. Solo las RPCs SECURITY DEFINER escriben.
--   * Helper interno `apply_ledger_entry()` con bloqueo de fila (FOR UPDATE)
--     para evitar race conditions de saldo.
--   * RPCs publicas: record_deposit_demo, record_withdraw_demo, record_bonus,
--     get_user_balance. Las dos primeras tienen tope MAX_DEPOSIT_DEMO de 100k.
--   * Auditoria automatica via write_audit() en cada movimiento.
--
-- NOTA — Migracion ADITIVA: NO modifica matchmaking_join ni resolve_match_round.
-- El cutover (saldo del juego derivado del ledger) llega en un PR aparte para
-- minimizar riesgo y permitir revisar la SQL critica aisladamente.
--
-- Idempotente: usa CREATE OR REPLACE / IF NOT EXISTS / DROP IF EXISTS.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- A) Tabla `transactions` + indices + Realtime publication
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.transactions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  kind              text NOT NULL CHECK (kind IN (
                      'deposit', 'withdraw', 'bet', 'win',
                      'fee',     'bonus',    'refund', 'adjustment'
                    )),
  amount            numeric(18, 6) NOT NULL CHECK (amount >= 0),
  balance_after     numeric(18, 6) NOT NULL CHECK (balance_after >= 0),
  idempotency_key   uuid NOT NULL,
  source            text NOT NULL
                    CHECK (length(source) BETWEEN 1 AND 128
                           AND source ~ '^[a-z][a-z0-9_:.\-]+$'),
  meta              jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Idempotencia: misma idempotency_key + mismo user = un solo asiento.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'transactions_user_idem_unique'
  ) THEN
    ALTER TABLE public.transactions
      ADD CONSTRAINT transactions_user_idem_unique
      UNIQUE (user_id, idempotency_key);
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS transactions_user_created_idx
  ON public.transactions (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS transactions_kind_created_idx
  ON public.transactions (kind, created_at DESC);

CREATE INDEX IF NOT EXISTS transactions_source_idx
  ON public.transactions (source);

-- Habilitamos RLS. Las policies de abajo niegan TODO a clientes excepto SELECT
-- del propio user_id. Las RPCs SECURITY DEFINER son las unicas que escriben.
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "transactions_select_own"        ON public.transactions;
DROP POLICY IF EXISTS "transactions_no_insert_client"  ON public.transactions;
DROP POLICY IF EXISTS "transactions_no_update_client"  ON public.transactions;
DROP POLICY IF EXISTS "transactions_no_delete_client"  ON public.transactions;

CREATE POLICY "transactions_select_own" ON public.transactions
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "transactions_no_insert_client" ON public.transactions
  FOR INSERT TO authenticated WITH CHECK (false);

CREATE POLICY "transactions_no_update_client" ON public.transactions
  FOR UPDATE TO authenticated USING (false) WITH CHECK (false);

CREATE POLICY "transactions_no_delete_client" ON public.transactions
  FOR DELETE TO authenticated USING (false);

-- Realtime: el cliente se suscribe via supabase.channel('public:transactions')
-- y recibe INSERTs para refrescar saldo en vivo. RLS sigue aplicando.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.transactions;
    EXCEPTION
      WHEN duplicate_object THEN NULL;  -- ya estaba en la publicacion
    END;
  END IF;
END$$;

-- ---------------------------------------------------------------------------
-- B) Helper interno: apply_ledger_entry()
--    Calcula `balance_after` atomicamente, bloqueando la ultima fila del user
--    para que dos requests concurrentes no creen race condition.
--    Idempotencia: si idempotency_key ya existe, devuelve el asiento previo
--    con `duplicate=true` (NO falla con 23505).
--
--    NO es publica. Solo las RPCs SECURITY DEFINER de abajo la usan.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_ledger_entry(
  p_user             uuid,
  p_kind             text,
  p_amount           numeric,
  p_idempotency_key  uuid,
  p_source           text,
  p_meta             jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dup_id        uuid;
  v_dup_balance   numeric;
  v_balance       numeric := 0;
  v_signed        numeric;
  v_new_balance   numeric;
  v_id            uuid;
  v_lock_target   uuid;
BEGIN
  IF p_user IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'idempotency_required' USING ERRCODE = 'P0001';
  END IF;

  IF p_amount IS NULL OR p_amount < 0 THEN
    RAISE EXCEPTION 'invalid_amount' USING ERRCODE = 'P0001';
  END IF;

  -- Idempotencia: si ya existe, devolvemos lo mismo (no error).
  SELECT t.id, t.balance_after INTO v_dup_id, v_dup_balance
  FROM public.transactions t
  WHERE t.user_id = p_user AND t.idempotency_key = p_idempotency_key;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'id', v_dup_id,
      'balance_after', v_dup_balance,
      'duplicate', true
    );
  END IF;

  -- Lock optimista: bloqueamos la fila mas reciente del user (si existe).
  -- Como `transactions` es append-only y el order by usa el indice
  -- (user_id, created_at DESC), esto es barato. Sin asientos previos no
  -- bloqueamos nada (todavia no hay carrera posible).
  SELECT t.id INTO v_lock_target
  FROM public.transactions t
  WHERE t.user_id = p_user
  ORDER BY t.created_at DESC
  LIMIT 1
  FOR UPDATE;

  -- Saldo actual = balance_after del ultimo asiento, o 0 si nunca tuvo.
  IF v_lock_target IS NOT NULL THEN
    SELECT t.balance_after INTO v_balance
    FROM public.transactions t
    WHERE t.id = v_lock_target;
  ELSE
    v_balance := 0;
  END IF;

  -- Signo segun kind. Todos los amounts son siempre positivos en la tabla.
  v_signed := CASE p_kind
    WHEN 'deposit'    THEN  p_amount
    WHEN 'win'        THEN  p_amount
    WHEN 'bonus'      THEN  p_amount
    WHEN 'refund'     THEN  p_amount
    WHEN 'withdraw'   THEN -p_amount
    WHEN 'bet'        THEN -p_amount
    WHEN 'fee'        THEN -p_amount
    WHEN 'adjustment' THEN
      CASE WHEN (COALESCE(p_meta, '{}'::jsonb)->>'direction') = 'debit'
           THEN -p_amount ELSE p_amount END
  END;

  IF v_signed IS NULL THEN
    RAISE EXCEPTION 'invalid_kind' USING ERRCODE = 'P0001';
  END IF;

  v_new_balance := v_balance + v_signed;

  IF v_new_balance < 0 THEN
    RAISE EXCEPTION 'insufficient_funds' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.transactions (
    user_id, kind, amount, balance_after, idempotency_key, source, meta
  ) VALUES (
    p_user, p_kind, p_amount, v_new_balance, p_idempotency_key, p_source,
    COALESCE(p_meta, '{}'::jsonb)
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'id', v_id,
    'balance_after', v_new_balance,
    'duplicate', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_ledger_entry(uuid, text, numeric, uuid, text, jsonb)
  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.apply_ledger_entry(uuid, text, numeric, uuid, text, jsonb)
  FROM authenticated, anon;
-- service_role la puede usar para reconciliaciones / migraciones; el cliente no.
GRANT EXECUTE ON FUNCTION public.apply_ledger_entry(uuid, text, numeric, uuid, text, jsonb)
  TO service_role;

-- ---------------------------------------------------------------------------
-- C) RPC publica: record_deposit_demo(amount, idempotency_key, meta?)
--    Acredita saldo virtual (sin pagar nada real). Tope MAX_DEPOSIT_DEMO 100k
--    para evitar abuso en la fase demo.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_deposit_demo(
  p_amount           numeric,
  p_idempotency_key  uuid,
  p_meta             jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid              uuid := auth.uid();
  v_result           jsonb;
  MIN_DEPOSIT_DEMO   constant numeric := 1;
  MAX_DEPOSIT_DEMO   constant numeric := 100000;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_amount' USING ERRCODE = 'P0001';
  END IF;
  IF p_amount < MIN_DEPOSIT_DEMO THEN
    RAISE EXCEPTION 'amount_too_small' USING ERRCODE = 'P0001';
  END IF;
  IF p_amount > MAX_DEPOSIT_DEMO THEN
    RAISE EXCEPTION 'amount_too_large' USING ERRCODE = 'P0001';
  END IF;

  v_result := public.apply_ledger_entry(
    v_uid, 'deposit', p_amount, p_idempotency_key, 'demo_modal',
    COALESCE(p_meta, '{}'::jsonb)
  );

  IF NOT COALESCE((v_result->>'duplicate')::boolean, false) THEN
    PERFORM public.write_audit('deposit_demo', (v_result->>'id'),
      jsonb_build_object(
        'amount', p_amount,
        'balance_after', v_result->'balance_after'
      ));
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.record_deposit_demo(numeric, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_deposit_demo(numeric, uuid, jsonb)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- D) RPC publica: record_withdraw_demo(amount, idempotency_key, meta?)
--    Debita saldo virtual. Falla con `insufficient_funds` si no hay suficiente.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_withdraw_demo(
  p_amount           numeric,
  p_idempotency_key  uuid,
  p_meta             jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid              uuid := auth.uid();
  v_result           jsonb;
  MIN_WITHDRAW_DEMO  constant numeric := 1;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_amount' USING ERRCODE = 'P0001';
  END IF;
  IF p_amount < MIN_WITHDRAW_DEMO THEN
    RAISE EXCEPTION 'amount_too_small' USING ERRCODE = 'P0001';
  END IF;

  v_result := public.apply_ledger_entry(
    v_uid, 'withdraw', p_amount, p_idempotency_key, 'demo_modal',
    COALESCE(p_meta, '{}'::jsonb)
  );

  IF NOT COALESCE((v_result->>'duplicate')::boolean, false) THEN
    PERFORM public.write_audit('withdraw_demo', (v_result->>'id'),
      jsonb_build_object(
        'amount', p_amount,
        'balance_after', v_result->'balance_after'
      ));
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.record_withdraw_demo(numeric, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_withdraw_demo(numeric, uuid, jsonb)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- E) RPC publica: record_bonus(amount, idempotency_key, reason)
--    Para el "free play first taste". El reason va a meta.reason y a audit_log.
--    Limitado a MAX_BONUS por idempotency_key (defensa: el cliente NO debe
--    poder darse a si mismo bonos arbitrarios). Hoy el cap es duro y el
--    cliente lo respeta; cuando agreguemos cuenta de bonos por user podemos
--    rechazar a partir del 2do.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_bonus(
  p_amount           numeric,
  p_idempotency_key  uuid,
  p_reason           text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_result    jsonb;
  v_reason    text;
  MAX_BONUS   constant numeric := 1000;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_amount' USING ERRCODE = 'P0001';
  END IF;
  IF p_amount > MAX_BONUS THEN
    RAISE EXCEPTION 'amount_too_large' USING ERRCODE = 'P0001';
  END IF;

  v_reason := COALESCE(NULLIF(btrim(p_reason), ''), 'unknown');
  IF length(v_reason) > 64 OR v_reason !~ '^[a-z][a-z0-9_:.\-]+$' THEN
    RAISE EXCEPTION 'invalid_reason' USING ERRCODE = 'P0001';
  END IF;

  v_result := public.apply_ledger_entry(
    v_uid, 'bonus', p_amount, p_idempotency_key,
    'bonus:' || v_reason,
    jsonb_build_object('reason', v_reason)
  );

  IF NOT COALESCE((v_result->>'duplicate')::boolean, false) THEN
    PERFORM public.write_audit('bonus_credit', (v_result->>'id'),
      jsonb_build_object(
        'amount', p_amount,
        'reason', v_reason,
        'balance_after', v_result->'balance_after'
      ));
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.record_bonus(numeric, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_bonus(numeric, uuid, text)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- F) RPC publica: get_user_balance()
--    Devuelve el saldo actual del usuario logueado, derivado del ultimo
--    asiento. STABLE para que Postgres pueda cachearla dentro del statement.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_user_balance()
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_balance numeric;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  SELECT t.balance_after INTO v_balance
  FROM public.transactions t
  WHERE t.user_id = v_uid
  ORDER BY t.created_at DESC
  LIMIT 1;

  RETURN COALESCE(v_balance, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_balance() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_balance()
  TO authenticated, service_role;

-- ===========================================================================
-- Fin de la migracion 20260512100000_transactions_ledger.sql
-- A continuacion: 20260512120000_ledger_cutover.sql — modifica matchmaking_join
-- y resolve_match_round para escribir asientos `bet`/`win` al ledger y agrega
-- refunds en cancel_matchmaking. Frontend (App.jsx) lee saldo desde
-- `useUserBalance(supaUserId)` con fallback a localStorage si Supabase no
-- esta configurado.
-- ===========================================================================
-- ChasFlip · Ledger cutover (FASE 2.B.2)
-- ===========================================================================
-- Conecta el matchmaking real al ledger autoritativo `public.transactions`
-- creado en 20260512100000_transactions_ledger.sql.
--
-- Cambios:
--   1. `match_queue` agrega columna `bet_idem_key uuid` (idempotency_key del
--      asiento `bet` creado al unirse). Necesaria para hacer refund al
--      cancelar.
--   2. `matchmaking_join(p_stake, p_idempotency_key uuid DEFAULT NULL)`:
--        * Si `p_idempotency_key` IS NOT NULL: debita un asiento `bet` ANTES
--          de tocar `match_queue`/`matches`. Si falla con `insufficient_funds`
--          o cualquier error, NO entra a cola (todo en una transaccion).
--        * Si `p_idempotency_key` IS NULL: comportamiento legacy (no toca
--          ledger). Mantiene compatibilidad para frontend pre-cutover.
--   3. `cancel_matchmaking()`: si el row tenia `bet_idem_key`, hace `refund`
--      antes de borrar el row.
--   4. `resolve_match_round(p_match_id)`: si declara winner == caller en esta
--      ejecucion (no en `already_resolved`), escribe asiento `win` con
--      idempotency_key deterministica derivada del match_id.
--
-- IMPORTANTE: el helper `deterministic_uuid()` produce UUID derivado de un
-- seed via md5. Esto da idempotencia perfecta para asientos cuyo "evento"
-- unico es identificable server-side (ej. "win" de un match dado solo puede
-- ocurrir una vez por match).
--
-- Idempotente: usa CREATE OR REPLACE / IF NOT EXISTS / DO blocks.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- A) Helper interno: deterministic_uuid(seed text) -> uuid
--    Para idempotency_keys derivadas server-side de eventos unicos (ej.
--    "win de match X"). RFC 4122 v5-like (manual, sin necesidad de uuid-ossp).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.deterministic_uuid(p_seed text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT (
    substr(md5(p_seed),  1, 8) || '-' ||
    substr(md5(p_seed),  9, 4) || '-' ||
    '5' || substr(md5(p_seed), 13, 3) || '-' ||
    '8' || substr(md5(p_seed), 16, 3) || '-' ||
    substr(md5(p_seed), 19, 12)
  )::uuid;
$$;

REVOKE ALL ON FUNCTION public.deterministic_uuid(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.deterministic_uuid(text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- B) match_queue ADD bet_idem_key uuid (idempotency_key del asiento `bet`)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'match_queue'
      AND column_name = 'bet_idem_key'
  ) THEN
    ALTER TABLE public.match_queue
      ADD COLUMN bet_idem_key uuid;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS match_queue_bet_idem_idx
  ON public.match_queue (bet_idem_key)
  WHERE bet_idem_key IS NOT NULL;

-- ---------------------------------------------------------------------------
-- C) matchmaking_join — versión cutover.
--    Acepta `p_idempotency_key uuid DEFAULT NULL`:
--      * NOT NULL → debita `bet -stake` al ledger ANTES de tocar match_queue
--        / matches. Si falla (insufficient_funds, etc.), NO entra a cola.
--      * NULL → comportamiento legacy idéntico al pre-cutover (sin ledger).
--
--    Idempotencia: si el cliente reintenta con la misma idem_key tras un
--    error de red, apply_ledger_entry devuelve duplicate=true y seguimos.
--    Si el match_queue ya tiene row del user en `waiting`, se respeta.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.matchmaking_join(
  p_stake_amount     integer,
  p_idempotency_key  uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid           uuid := auth.uid();
  v_commission    numeric(12, 10);
  v_opp           uuid;
  v_opp_avatar    text;
  v_opp_pais      text;
  v_opp_email     text;
  v_join_avatar   text;
  v_join_pais     text;
  v_join_email    text;
  v_match_id      uuid;
  v_queue_id      uuid;
  v_meta          jsonb;
  v_opp_queue_id  uuid;
  v_opp_idem      uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;

  v_commission := public.commission_for_stake(p_stake_amount);
  IF v_commission IS NULL THEN
    PERFORM public.write_audit('matchmaking_join_invalid_stake', NULL,
      jsonb_build_object('stake_amount', p_stake_amount));
    RAISE EXCEPTION 'invalid_stake_tier' USING ERRCODE = 'P0001';
  END IF;

  -- Limpiamos waiting previos del mismo user (mismo flow que antes).
  -- Si tenian bet_idem_key, ese asiento ya cobrado se queda en ledger; no
  -- refund-eamos porque el cliente esta SUBSTITUYENDO con un nuevo intento.
  -- Para refund explicito, usar cancel_matchmaking().
  DELETE FROM public.match_queue mq
  WHERE mq.user_id = v_uid AND mq.status = 'waiting';

  -- Debit `bet` si el cliente pidió ledger.
  IF p_idempotency_key IS NOT NULL THEN
    BEGIN
      PERFORM public.apply_ledger_entry(
        v_uid, 'bet', p_stake_amount, p_idempotency_key,
        'match:queue:pending',  -- se actualiza meta.queue_id luego si entra a cola
        jsonb_build_object('stake_amount', p_stake_amount)
      );
    EXCEPTION
      WHEN SQLSTATE 'P0001' THEN
        PERFORM public.write_audit('match_bet_failed', NULL,
          jsonb_build_object(
            'stake_amount', p_stake_amount,
            'reason', SQLERRM
          ));
        RAISE;
    END;
  END IF;

  -- Busca oponente waiting al mismo stake.
  SELECT q.user_id, q.id, q.bet_idem_key INTO v_opp, v_opp_queue_id, v_opp_idem
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
      ),
      'bet_idem_keys', jsonb_build_object(
        'player_one', v_opp_idem,
        'player_two', p_idempotency_key
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
        'opponent_id', v_opp,
        'bet_idem_keys', v_meta->'bet_idem_keys'
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

  INSERT INTO public.match_queue (
    user_id, stake_amount, commission_decimal, status, bet_idem_key
  )
  VALUES (v_uid, p_stake_amount, v_commission, 'waiting', p_idempotency_key)
  RETURNING id INTO v_queue_id;

  PERFORM public.write_audit('match_queued', v_queue_id::text,
    jsonb_build_object(
      'stake_amount', p_stake_amount,
      'bet_idem_key', p_idempotency_key
    ));

  RETURN jsonb_build_object(
    'matched', false,
    'queue_id', v_queue_id,
    'stake_amount', p_stake_amount,
    'commission_decimal', v_commission
  );
END;
$$;

-- DROP la version vieja (single-arg) si existia, para no dejar overload
-- confundidor. La nueva acepta el segundo arg con DEFAULT NULL asi que
-- llamadas `matchmaking_join(10)` siguen funcionando.
DROP FUNCTION IF EXISTS public.matchmaking_join(integer);

REVOKE ALL ON FUNCTION public.matchmaking_join(integer, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.matchmaking_join(integer, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- D) cancel_matchmaking — agrega refund por cada row eliminado con bet_idem_key.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_matchmaking()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_deleted   integer := 0;
  v_refunded  integer := 0;
  r           record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;

  -- Iteramos los waiting rows del user. Para cada uno con bet_idem_key,
  -- emitimos un refund antes de borrar. Idempotency_key del refund deriva
  -- del queue_id (deterministica → si se llama 2 veces no duplica).
  FOR r IN
    SELECT id, stake_amount, bet_idem_key
    FROM public.match_queue
    WHERE user_id = v_uid AND status = 'waiting'
    FOR UPDATE
  LOOP
    IF r.bet_idem_key IS NOT NULL THEN
      BEGIN
        PERFORM public.apply_ledger_entry(
          v_uid, 'refund', r.stake_amount,
          public.deterministic_uuid('refund:queue:' || r.id::text),
          'match:cancel:' || r.id::text,
          jsonb_build_object(
            'queue_id', r.id,
            'stake_amount', r.stake_amount,
            'original_bet_idem_key', r.bet_idem_key
          )
        );
        v_refunded := v_refunded + 1;
      EXCEPTION WHEN OTHERS THEN
        PERFORM public.write_audit('cancel_refund_failed', r.id::text,
          jsonb_build_object('error', SQLERRM));
      END;
    END IF;

    DELETE FROM public.match_queue WHERE id = r.id;
    v_deleted := v_deleted + 1;
  END LOOP;

  PERFORM public.write_audit('match_cancel', NULL,
    jsonb_build_object('deleted_rows', v_deleted, 'refunded_rows', v_refunded));

  RETURN jsonb_build_object(
    'ok', true,
    'deleted', v_deleted,
    'refunded', v_refunded
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_matchmaking() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_matchmaking() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- E) resolve_match_round — agrega asiento `win` al ganador (si tiene cuenta).
--
--    El asiento se escribe SOLO la primera vez que la fila pasa a 'completed'.
--    En llamadas posteriores (already_resolved == true) NO se vuelve a tocar
--    el ledger. La idempotency_key es deterministica
--    (`deterministic_uuid('win:'||match_id)`), así que aunque el bloque
--    INSERT corriera dos veces (no debería gracias al FOR UPDATE del match),
--    apply_ledger_entry devolveria duplicate=true.
--
--    NO se escribe asiento para el perdedor: el `bet` ya fue cobrado al
--    unirse (Fase 2.B.2 cutover), así que el perdedor simplemente "perdió
--    lo que apostó".
--
--    NO se escribe asiento de `fee` aún (no hay tabla de tesoreria). El fee
--    queda capturado en `matches.protocol_fee_total` y la diferencia entre
--    `sum(bet)` y `sum(win)` por match es exactamente `2S*fee`. Suficiente
--    auditoría hasta que llegue Fase 2.C / treasury ledger.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_match_round(p_match_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid             uuid := auth.uid();
  m                 public.matches%ROWTYPE;
  v_winner          uuid;
  v_won             boolean;
  v_payout          numeric;
  v_pay_all         numeric;
  v_fee_total       numeric;
  v_already         boolean := false;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;

  SELECT * INTO m FROM public.matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'match_not_found' USING ERRCODE = 'P0001'; END IF;

  IF v_uid <> m.player_one_id AND v_uid <> m.player_two_id THEN
    PERFORM public.write_audit('match_resolve_forbidden', p_match_id::text, '{}'::jsonb);
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF m.status = 'completed' AND m.winner_user_id IS NOT NULL THEN
    v_already   := true;
    v_won       := (m.winner_user_id = v_uid);
    v_pay_all   := COALESCE(m.payout_winner_numeric,
      (2::numeric * m.stake_amount::numeric * (1::numeric - m.commission_decimal)));
    v_fee_total := COALESCE(m.protocol_fee_total,
      (2::numeric * m.stake_amount::numeric * m.commission_decimal));
    v_payout    := CASE WHEN v_won THEN v_pay_all ELSE 0::numeric END;
    v_winner    := m.winner_user_id;
  ELSE
    IF m.status <> 'in_progress' THEN RAISE EXCEPTION 'match_not_in_progress' USING ERRCODE = 'P0001'; END IF;

    -- TODO[fase2.C]: reemplazar random() por Chainlink VRF cuando haya dinero real.
    v_winner    := CASE WHEN random() < 0.5 THEN m.player_one_id ELSE m.player_two_id END;
    v_won       := (v_winner = v_uid);
    v_pay_all   := 2::numeric * m.stake_amount::numeric * (1::numeric - m.commission_decimal);
    v_fee_total := 2::numeric * m.stake_amount::numeric * m.commission_decimal;
    v_payout    := CASE WHEN v_won THEN v_pay_all ELSE 0::numeric END;

    UPDATE public.matches AS x
    SET winner_user_id = v_winner,
        status = 'completed',
        completed_at = now(),
        payout_winner_numeric = v_pay_all,
        protocol_fee_total = v_fee_total
    WHERE x.id = p_match_id;

    -- Escribimos asiento `win` para el ganador (server-side, no depende del
    -- caller). Idempotency_key deterministica garantiza que aunque dos
    -- caminos llegaran a este punto, solo se contabiliza una vez.
    BEGIN
      PERFORM public.apply_ledger_entry(
        v_winner, 'win', v_pay_all,
        public.deterministic_uuid('win:' || p_match_id::text),
        'match:win:' || p_match_id::text,
        jsonb_build_object(
          'match_id', p_match_id,
          'stake_amount', m.stake_amount,
          'commission_decimal', m.commission_decimal,
          'fee_total', v_fee_total
        )
      );
    EXCEPTION WHEN OTHERS THEN
      -- Si el ganador no tenia asiento `bet` previo (frontend pre-cutover
      -- que no debitó), aún así escribimos: 'win' suma sin importar saldo
      -- previo. Si falló por otra razón, lo auditamos pero seguimos: el
      -- match ya quedó marcado completed en `matches`.
      PERFORM public.write_audit('match_win_ledger_failed', p_match_id::text,
        jsonb_build_object('error', SQLERRM, 'winner_id', v_winner));
    END;

    PERFORM public.write_audit('match_resolved', p_match_id::text,
      jsonb_build_object(
        'winner_id', v_winner,
        'stake_amount', m.stake_amount,
        'commission_decimal', m.commission_decimal,
        'payout_winner_numeric', v_pay_all,
        'protocol_fee_total', v_fee_total
      ));
  END IF;

  RETURN jsonb_build_object(
    'won', v_won,
    'payout', v_payout,
    'winner_id', v_winner,
    'commission_decimal', m.commission_decimal,
    'stake_amount', m.stake_amount,
    'match_id', p_match_id,
    'already_resolved', v_already,
    'payout_winner_numeric', v_pay_all,
    'protocol_fee_total', v_fee_total
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_match_round(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_match_round(uuid) TO authenticated, service_role;

-- ===========================================================================
-- Fin de la migracion 20260512120000_ledger_cutover.sql
-- ===========================================================================
