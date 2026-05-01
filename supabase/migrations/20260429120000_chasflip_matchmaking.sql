-- ChasFlip: perfiles, cola de matching, partidas y RPC con comisión solo en servidor.
-- Habilita "Anonymous sign-ins" en Auth (Supabase Dashboard) para cuentas demo.

-- ---------------------------------------------------------------------------
-- Comisión autoritativa por tier (debe coincidir con producto; no confiar en el cliente)
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Perfiles (avatar, país, wallet opcional) — ligados a auth.users
-- ---------------------------------------------------------------------------
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  email text,
  avatar text NOT NULL DEFAULT '👤',
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

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_profiles_updated_at();

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select_own"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "profiles_insert_own"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- ---------------------------------------------------------------------------
-- Cola de matching (solo accesible vía RPC security definer)
-- ---------------------------------------------------------------------------
CREATE TABLE public.match_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  stake_amount integer NOT NULL,
  commission_decimal numeric(12, 10) NOT NULL,
  status text NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX match_queue_one_waiting_per_user
  ON public.match_queue (user_id)
  WHERE (status = 'waiting');

CREATE INDEX match_queue_waiting_stake_created
  ON public.match_queue (stake_amount, created_at)
  WHERE (status = 'waiting');

ALTER TABLE public.match_queue ENABLE ROW LEVEL SECURITY;

-- Sin políticas → los clientes no leen/escriben tablas directamente.

-- ---------------------------------------------------------------------------
-- Partidas
-- ---------------------------------------------------------------------------
CREATE TABLE public.matches (
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

CREATE INDEX matches_players_created
  ON public.matches (player_one_id, created_at DESC);

CREATE INDEX matches_player_two_created
  ON public.matches (player_two_id, created_at DESC);

ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "matches_select_participants"
  ON public.matches FOR SELECT
  TO authenticated
  USING (auth.uid() = player_one_id OR auth.uid() = player_two_id);

-- Tiempo real: suscripciones a filas donde el usuario participa
ALTER PUBLICATION supabase_realtime ADD TABLE public.matches;

-- ---------------------------------------------------------------------------
-- RPC: entrar en cola o emparejar (comisión desde commission_for_stake)
-- ---------------------------------------------------------------------------
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
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_commission := public.commission_for_stake(p_stake_amount);
  IF v_commission IS NULL THEN
    RAISE EXCEPTION 'Invalid stake tier';
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
        'avatar', COALESCE(v_join_avatar, '👤'),
        'pais_code', COALESCE(v_join_pais, 'XX'),
        'email', v_join_email
      ),
      'player_two_sees', jsonb_build_object(
        'avatar', COALESCE(v_opp_avatar, '👤'),
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
        'avatar', COALESCE(v_opp_avatar, '👤'),
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

-- ---------------------------------------------------------------------------
-- RPC: cancelar espera en cola
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_matchmaking()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  DELETE FROM public.match_queue mq
  WHERE mq.user_id = v_uid AND mq.status = 'waiting';
  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_matchmaking() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_matchmaking() TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_matchmaking() TO service_role;

-- ---------------------------------------------------------------------------
-- RPC: resolver partida (RNG en servidor, payout 2·S·(1−fee) si ganas)
-- ---------------------------------------------------------------------------
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
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO m
  FROM public.matches
  WHERE id = p_match_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Match not found';
  END IF;

  IF v_uid <> m.player_one_id AND v_uid <> m.player_two_id THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  -- Idempotente: segunda llamada devuelve el mismo resultado auditado en fila.
  IF m.status = 'completed' AND m.winner_user_id IS NOT NULL THEN
    v_won := (m.winner_user_id = v_uid);
    v_payout := CASE
      WHEN v_won THEN (2::numeric * m.stake_amount::numeric * (1::numeric - m.commission_decimal))
      ELSE 0::numeric
    END;
    RETURN jsonb_build_object(
      'won', v_won,
      'payout', v_payout,
      'winner_id', m.winner_user_id,
      'commission_decimal', m.commission_decimal,
      'stake_amount', m.stake_amount,
      'match_id', p_match_id,
      'already_resolved', true
    );
  END IF;

  IF m.status <> 'in_progress' THEN
    RAISE EXCEPTION 'Match not in progress';
  END IF;

  v_winner := CASE WHEN random() < 0.5 THEN m.player_one_id ELSE m.player_two_id END;
  v_won := (v_winner = v_uid);
  v_payout := CASE
    WHEN v_won THEN (2::numeric * m.stake_amount::numeric * (1::numeric - m.commission_decimal))
    ELSE 0::numeric
  END;

  UPDATE public.matches AS x
  SET
    winner_user_id = v_winner,
    status = 'completed',
    completed_at = now()
  WHERE x.id = p_match_id;

  RETURN jsonb_build_object(
    'won', v_won,
    'payout', v_payout,
    'winner_id', v_winner,
    'commission_decimal', m.commission_decimal,
    'stake_amount', m.stake_amount,
    'match_id', p_match_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_match_round(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_match_round(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_match_round(uuid) TO service_role;
