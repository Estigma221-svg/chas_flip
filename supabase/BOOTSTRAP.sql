-- ChasFlip · BOOTSTRAP completo (idempotente)
-- Pega este archivo en Supabase Dashboard → SQL Editor → Run.
-- Equivale a aplicar TODAS las migraciones en `supabase/migrations/` en orden:
--   20260429120000_chasflip_matchmaking.sql
--   20260430104500_matches_payout_audit.sql
--   20260501123000_commissions_v2.sql
--   20260501142000_chat_messages.sql
--   20260501150000_user_stats.sql
--   20260501161500_messages_v2_columns.sql
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
