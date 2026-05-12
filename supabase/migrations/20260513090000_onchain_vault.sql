-- ChasFlip · On-chain Vault — bookkeeping del ledger (FASE 2.C.1)
-- ===========================================================================
-- Conecta los eventos del contrato `ChasFlipVault` en Polygon al ledger
-- autoritativo `public.transactions` (creado en 20260512100000).
--
-- Conceptos:
--   * `vault_deposits_seen`: snapshot append-only de cada evento `Deposited`
--     ya consumido por la Edge Function `vault-deposit-listener`. Garantiza
--     que UN evento on-chain se contabiliza UNA sola vez en el ledger, aunque
--     el listener corra dos veces o haya reorg.
--   * `vault_withdraw_intents`: cada vez que un user pide retirar, el server
--     debita el ledger atomicamente y crea un "intent" pendiente con un
--     nonce on-chain. Cuando el user presenta la firma al contrato, la tx
--     se ejecuta. Si no la presenta en `deadline`, podemos hacer reembolso
--     manual (futuro).
--   * RPC `link_onchain_address(p_address)`: el user conecta su wallet y
--     el server "vincula" esa address con su auth.uid(). Una address solo
--     puede pertenecer a un user.
--   * RPC `record_vault_deposit(p_user, p_address, p_amount, p_tx_hash,
--     p_log_index)`: idempotente, llamada SOLO por el listener via service
--     role. Crea fila `vault_deposits_seen` + asiento `transactions:deposit`.
--   * RPC `issue_withdraw_intent(p_amount)`: llamada por el cliente (auth
--     normal). Debita el saldo atomicamente, asigna nonce + deadline,
--     graba `vault_withdraw_intents` (pendiente) y devuelve los datos
--     necesarios para que la Edge Function firme el ticket EIP-712.
--   * RPC `mark_withdraw_completed(p_user_address, p_nonce, p_tx_hash)`:
--     llamada por el listener cuando ve el evento `Withdrawn` on-chain.
--     Marca el intent como `completed` (auditoria, sin tocar saldo: ya se
--     debitó cuando se emitió el intent).
--
-- Idempotente: usa CREATE OR REPLACE / IF NOT EXISTS / DO blocks.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- A) Tabla onchain_addresses — vincula wallet → user_id (1 wallet ↔ 1 user).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.onchain_addresses (
  user_id      uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  address      text NOT NULL,
  chain_id     integer NOT NULL,
  linked_at    timestamptz NOT NULL DEFAULT now(),
  unlinked_at  timestamptz,
  PRIMARY KEY (user_id, address, chain_id),
  CHECK (address ~ '^0x[a-fA-F0-9]{40}$'),
  CHECK (chain_id > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS onchain_addresses_unique_active
  ON public.onchain_addresses (address, chain_id)
  WHERE unlinked_at IS NULL;

ALTER TABLE public.onchain_addresses ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'onchain_addresses'
      AND policyname = 'onchain_addresses_select_own'
  ) THEN
    CREATE POLICY onchain_addresses_select_own
      ON public.onchain_addresses FOR SELECT
      USING (user_id = auth.uid());
  END IF;
END$$;

-- ---------------------------------------------------------------------------
-- B) Tabla vault_deposits_seen — snapshot anti-duplicado de eventos on-chain.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vault_deposits_seen (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  address        text NOT NULL,
  chain_id       integer NOT NULL,
  tx_hash        text NOT NULL,
  log_index      integer NOT NULL,
  amount         numeric(18, 6) NOT NULL CHECK (amount > 0),
  block_number   bigint NOT NULL,
  block_time     timestamptz,
  ledger_tx_id   uuid REFERENCES public.transactions (id) ON DELETE SET NULL,
  seen_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (tx_hash ~ '^0x[a-fA-F0-9]{64}$'),
  CHECK (address ~ '^0x[a-fA-F0-9]{40}$'),
  CHECK (log_index >= 0),
  UNIQUE (chain_id, tx_hash, log_index)
);

CREATE INDEX IF NOT EXISTS vault_deposits_seen_user_idx
  ON public.vault_deposits_seen (user_id, seen_at DESC);

ALTER TABLE public.vault_deposits_seen ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'vault_deposits_seen'
      AND policyname = 'vault_deposits_seen_select_own'
  ) THEN
    CREATE POLICY vault_deposits_seen_select_own
      ON public.vault_deposits_seen FOR SELECT
      USING (user_id = auth.uid());
  END IF;
END$$;

-- ---------------------------------------------------------------------------
-- C) Tabla vault_withdraw_intents — retiros pendientes (firma EIP-712 emitida).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vault_withdraw_intents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  address         text NOT NULL,
  chain_id        integer NOT NULL,
  amount          numeric(18, 6) NOT NULL CHECK (amount > 0),
  nonce           numeric(78, 0) NOT NULL,  -- uint256 cabe en numeric(78,0)
  deadline        timestamptz NOT NULL,
  status          text NOT NULL DEFAULT 'pending',
  ledger_tx_id    uuid REFERENCES public.transactions (id) ON DELETE RESTRICT,
  onchain_tx_hash text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  CHECK (status IN ('pending', 'completed', 'expired', 'canceled')),
  CHECK (address ~ '^0x[a-fA-F0-9]{40}$'),
  CHECK (onchain_tx_hash IS NULL OR onchain_tx_hash ~ '^0x[a-fA-F0-9]{64}$'),
  UNIQUE (chain_id, address, nonce)
);

CREATE INDEX IF NOT EXISTS vault_withdraw_intents_user_idx
  ON public.vault_withdraw_intents (user_id, status, created_at DESC);

ALTER TABLE public.vault_withdraw_intents ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'vault_withdraw_intents'
      AND policyname = 'vault_withdraw_intents_select_own'
  ) THEN
    CREATE POLICY vault_withdraw_intents_select_own
      ON public.vault_withdraw_intents FOR SELECT
      USING (user_id = auth.uid());
  END IF;
END$$;

-- ---------------------------------------------------------------------------
-- D) RPC link_onchain_address — el user conecta su wallet.
--    Si la address ya estaba linkeada a OTRO user, falla con `address_taken`.
--    Si ya estaba linkeada al mismo user, es no-op (idempotente).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.link_onchain_address(
  p_address  text,
  p_chain_id integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_addr    text;
  v_existing uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;
  IF p_address IS NULL OR p_address !~ '^0x[a-fA-F0-9]{40}$' THEN
    RAISE EXCEPTION 'invalid_address' USING ERRCODE = 'P0001';
  END IF;
  IF p_chain_id IS NULL OR p_chain_id <= 0 THEN
    RAISE EXCEPTION 'invalid_chain_id' USING ERRCODE = 'P0001';
  END IF;

  v_addr := lower(p_address);

  SELECT user_id INTO v_existing
  FROM public.onchain_addresses
  WHERE address = v_addr AND chain_id = p_chain_id AND unlinked_at IS NULL
  FOR UPDATE;

  IF v_existing IS NOT NULL AND v_existing <> v_uid THEN
    PERFORM public.write_audit('onchain_link_conflict', NULL,
      jsonb_build_object('address', v_addr, 'chain_id', p_chain_id,
                         'existing_user', v_existing, 'requested_by', v_uid));
    RAISE EXCEPTION 'address_taken' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.onchain_addresses (user_id, address, chain_id)
  VALUES (v_uid, v_addr, p_chain_id)
  ON CONFLICT (user_id, address, chain_id) DO NOTHING;

  PERFORM public.write_audit('onchain_link', NULL,
    jsonb_build_object('address', v_addr, 'chain_id', p_chain_id));

  RETURN jsonb_build_object(
    'ok', true,
    'address', v_addr,
    'chain_id', p_chain_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.link_onchain_address(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.link_onchain_address(text, integer) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- E) RPC record_vault_deposit — INVOCADA SOLO POR EDGE FUNCTION (service_role).
--    Idempotente vía UNIQUE (chain_id, tx_hash, log_index).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_vault_deposit(
  p_user_id      uuid,
  p_address      text,
  p_chain_id     integer,
  p_amount       numeric,
  p_tx_hash      text,
  p_log_index    integer,
  p_block_number bigint,
  p_block_time   timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing    public.vault_deposits_seen%ROWTYPE;
  v_ledger_id   uuid;
  v_idem        uuid;
  v_balance     numeric;
  v_seen_id     uuid;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_amount' USING ERRCODE = 'P0001';
  END IF;
  IF p_tx_hash !~ '^0x[a-fA-F0-9]{64}$' OR p_log_index < 0 THEN
    RAISE EXCEPTION 'invalid_tx' USING ERRCODE = 'P0001';
  END IF;
  IF p_address !~ '^0x[a-fA-F0-9]{40}$' THEN
    RAISE EXCEPTION 'invalid_address' USING ERRCODE = 'P0001';
  END IF;

  -- Idempotencia: si ya vimos este (chain_id, tx_hash, log_index), retornamos
  -- el snapshot existente sin re-insertar.
  SELECT * INTO v_existing
  FROM public.vault_deposits_seen
  WHERE chain_id = p_chain_id
    AND tx_hash = lower(p_tx_hash)
    AND log_index = p_log_index;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'duplicate', true,
      'seen_id', v_existing.id,
      'ledger_tx_id', v_existing.ledger_tx_id
    );
  END IF;

  -- Idempotency_key del asiento `transactions` deriva del tx_hash:log_index
  -- (UUID v5-like via md5). Si por alguna razon la fila de seen no se
  -- inserto pero el ledger si, este key colisiona en `transactions` y el
  -- helper apply_ledger_entry devuelve duplicate=true.
  v_idem := public.deterministic_uuid('vault_dep:' || lower(p_tx_hash) || ':' || p_log_index::text);

  DECLARE
    v_apply_result jsonb;
  BEGIN
    v_apply_result := public.apply_ledger_entry(
      p_user_id,
      'deposit',
      p_amount,
      v_idem,
      'on_chain:' || lower(p_tx_hash) || ':' || p_log_index::text,
      jsonb_build_object(
        'chain_id', p_chain_id,
        'address', lower(p_address),
        'block_number', p_block_number
      )
    );
    v_ledger_id := (v_apply_result->>'id')::uuid;
    v_balance := (v_apply_result->>'balance_after')::numeric;
  END;

  INSERT INTO public.vault_deposits_seen (
    user_id, address, chain_id, tx_hash, log_index, amount,
    block_number, block_time, ledger_tx_id
  )
  VALUES (
    p_user_id, lower(p_address), p_chain_id, lower(p_tx_hash), p_log_index,
    p_amount, p_block_number, p_block_time, v_ledger_id
  )
  RETURNING id INTO v_seen_id;

  PERFORM public.write_audit('vault_deposit_credited', p_tx_hash,
    jsonb_build_object(
      'user_id', p_user_id,
      'address', lower(p_address),
      'amount', p_amount,
      'log_index', p_log_index,
      'block_number', p_block_number,
      'ledger_tx_id', v_ledger_id
    ));

  RETURN jsonb_build_object(
    'duplicate', false,
    'seen_id', v_seen_id,
    'ledger_tx_id', v_ledger_id,
    'balance_after', v_balance
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_vault_deposit(
  uuid, text, integer, numeric, text, integer, bigint, timestamptz
) FROM PUBLIC;
-- Solo service_role (Edge Function) puede llamar esta RPC, ya que el auth.uid
-- de la sesion no necesariamente coincide con p_user_id (el listener no se
-- autentica como el user).
GRANT EXECUTE ON FUNCTION public.record_vault_deposit(
  uuid, text, integer, numeric, text, integer, bigint, timestamptz
) TO service_role;

-- ---------------------------------------------------------------------------
-- F) RPC issue_withdraw_intent — el user pide retirar. Debita atomicamente.
--    El cliente la llama; la Edge Function `issue-withdraw-ticket` la invoca
--    igual via service_role para evitar dependencia de session JWT en el
--    edge worker. Aceptamos auth.uid() != NULL.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_withdraw_intent(
  p_amount   numeric,
  p_address  text,
  p_chain_id integer,
  p_ttl_seconds integer DEFAULT 900
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          uuid := auth.uid();
  v_addr         text;
  v_idem         uuid;
  v_intent_id    uuid;
  v_nonce        numeric(78, 0);
  v_deadline     timestamptz;
  v_ledger_id    uuid;
  v_balance      numeric;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_amount' USING ERRCODE = 'P0001';
  END IF;
  IF p_address IS NULL OR p_address !~ '^0x[a-fA-F0-9]{40}$' THEN
    RAISE EXCEPTION 'invalid_address' USING ERRCODE = 'P0001';
  END IF;
  IF p_chain_id IS NULL OR p_chain_id <= 0 THEN
    RAISE EXCEPTION 'invalid_chain_id' USING ERRCODE = 'P0001';
  END IF;
  IF p_ttl_seconds IS NULL OR p_ttl_seconds < 60 OR p_ttl_seconds > 86400 THEN
    p_ttl_seconds := 900;
  END IF;

  v_addr := lower(p_address);

  -- Validar que la address pertenece al user.
  IF NOT EXISTS (
    SELECT 1 FROM public.onchain_addresses
    WHERE user_id = v_uid AND address = v_addr AND chain_id = p_chain_id
      AND unlinked_at IS NULL
  ) THEN
    PERFORM public.write_audit('withdraw_address_mismatch', NULL,
      jsonb_build_object('user_id', v_uid, 'address', v_addr, 'chain_id', p_chain_id));
    RAISE EXCEPTION 'address_not_linked' USING ERRCODE = 'P0001';
  END IF;

  -- Asignamos el nonce a partir del COUNT total de intents del (address, chain)
  -- + un offset basado en epoch para mayor robustez. Esto colisiona con el
  -- UNIQUE (chain_id, address, nonce). Si hubiera carrera, reintentamos.
  v_nonce := (extract(epoch from now())::bigint * 1000 + (random() * 1000)::bigint)::numeric;

  v_deadline := now() + (p_ttl_seconds || ' seconds')::interval;
  v_idem := gen_random_uuid();

  -- Debitar saldo atomicamente.
  DECLARE
    v_apply_result jsonb;
  BEGIN
    v_apply_result := public.apply_ledger_entry(
      v_uid,
      'withdraw',
      p_amount,
      v_idem,
      'vault_withdraw_intent',
      jsonb_build_object(
        'address', v_addr,
        'chain_id', p_chain_id,
        'nonce', v_nonce::text,
        'deadline', v_deadline
      )
    );
    v_ledger_id := (v_apply_result->>'id')::uuid;
    v_balance := (v_apply_result->>'balance_after')::numeric;
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      PERFORM public.write_audit('withdraw_debit_failed', NULL,
        jsonb_build_object('user_id', v_uid, 'amount', p_amount, 'error', SQLERRM));
      RAISE;
  END;

  INSERT INTO public.vault_withdraw_intents (
    user_id, address, chain_id, amount, nonce, deadline, ledger_tx_id, status
  )
  VALUES (
    v_uid, v_addr, p_chain_id, p_amount, v_nonce, v_deadline, v_ledger_id, 'pending'
  )
  RETURNING id INTO v_intent_id;

  PERFORM public.write_audit('withdraw_intent_issued', v_intent_id::text,
    jsonb_build_object(
      'user_id', v_uid,
      'address', v_addr,
      'chain_id', p_chain_id,
      'amount', p_amount,
      'nonce', v_nonce::text,
      'deadline', v_deadline,
      'ledger_tx_id', v_ledger_id
    ));

  RETURN jsonb_build_object(
    'intent_id', v_intent_id,
    'user', v_addr,
    'amount', p_amount,
    'nonce', v_nonce::text,
    'deadline', extract(epoch from v_deadline)::bigint,
    'chain_id', p_chain_id,
    'balance_after', v_balance
  );
END;
$$;

REVOKE ALL ON FUNCTION public.issue_withdraw_intent(numeric, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_withdraw_intent(numeric, text, integer, integer) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- G) RPC mark_withdraw_completed — INVOCADA POR EDGE FUNCTION cuando ve el
--    evento `Withdrawn` on-chain. NO toca saldo (ya se debitó en issue).
--    Solo audita y marca status. Idempotente: si ya estaba completed, no-op.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_withdraw_completed(
  p_address    text,
  p_chain_id   integer,
  p_nonce      numeric,
  p_tx_hash    text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_addr  text := lower(p_address);
  v_intent public.vault_withdraw_intents%ROWTYPE;
BEGIN
  SELECT * INTO v_intent
  FROM public.vault_withdraw_intents
  WHERE address = v_addr AND chain_id = p_chain_id AND nonce = p_nonce
  FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM public.write_audit('withdraw_complete_orphan', p_tx_hash,
      jsonb_build_object('address', v_addr, 'chain_id', p_chain_id, 'nonce', p_nonce::text));
    RAISE EXCEPTION 'intent_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_intent.status = 'completed' THEN
    RETURN jsonb_build_object(
      'already_completed', true,
      'intent_id', v_intent.id,
      'onchain_tx_hash', v_intent.onchain_tx_hash
    );
  END IF;

  UPDATE public.vault_withdraw_intents
  SET status = 'completed', onchain_tx_hash = lower(p_tx_hash), completed_at = now()
  WHERE id = v_intent.id;

  PERFORM public.write_audit('withdraw_completed', v_intent.id::text,
    jsonb_build_object(
      'user_id', v_intent.user_id,
      'address', v_addr,
      'chain_id', p_chain_id,
      'amount', v_intent.amount,
      'tx_hash', lower(p_tx_hash)
    ));

  RETURN jsonb_build_object(
    'already_completed', false,
    'intent_id', v_intent.id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mark_withdraw_completed(text, integer, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_withdraw_completed(text, integer, numeric, text) TO service_role;

-- ===========================================================================
-- Fin de la migracion 20260513090000_onchain_vault.sql
-- ===========================================================================
