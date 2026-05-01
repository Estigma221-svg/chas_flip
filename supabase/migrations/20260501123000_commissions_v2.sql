-- Actualiza la tabla de comisiones autoritativa por tier (acordada en producto 2026-05-01).
-- Mismo orden de magnitudes; tasas más amistosas para el jugador en mesas chicas.
-- IMMUTABLE conserva: el resultado depende solo del input p_stake.

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
