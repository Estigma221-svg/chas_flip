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
