-- Stats agregadas por jugador para badges "social proof" del chat en vivo.
-- Realtime: canal público de UPDATE para que el chat sincronice el badge sin
-- exponer datos sensibles del perfil (wallet_address, email).

CREATE TABLE IF NOT EXISTS public.user_stats (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  total_won numeric(24, 10) NOT NULL DEFAULT 0,
  total_lost numeric(24, 10) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_stats ENABLE ROW LEVEL SECURITY;

-- SELECT abierto a authenticated: solo expone PnL agregado, no datos privados.
DROP POLICY IF EXISTS "user_stats_select_authenticated" ON public.user_stats;
CREATE POLICY "user_stats_select_authenticated"
  ON public.user_stats
  FOR SELECT
  TO authenticated
  USING (true);

-- Sin políticas INSERT/UPDATE: solo el trigger SECURITY DEFINER puede mutar.

-- ---------------------------------------------------------------------------
-- Trigger: al cerrarse una partida, sumar a winner / loser.
--   total_won += max(payout_winner - stake, 0) (ganancia neta del flip)
--   total_lost += stake (lo que pagó el perdedor)
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Realtime: habilita postgres_changes en user_stats (UPDATE / INSERT).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename  = 'user_stats'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.user_stats';
  END IF;
END
$$;
