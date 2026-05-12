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
-- Proximo paso (Fase 2.B.2): cutover — modificar matchmaking_join y
-- resolve_match_round para escribir asientos `bet`/`win`/`fee` al ledger, y
-- migrar el frontend para leer el saldo de get_user_balance() en lugar de
-- localStorage.
-- ===========================================================================
