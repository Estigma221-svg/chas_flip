-- Auditoría económica en la fila de partida (además de commission_decimal ya existente).

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS payout_winner_numeric numeric(24, 10),
  ADD COLUMN IF NOT EXISTS protocol_fee_total numeric(24, 10);

COMMENT ON COLUMN public.matches.stake_amount IS 'S por jugador; pot escrow teórico 2·S.';
COMMENT ON COLUMN public.matches.commission_decimal IS 'Fee sobre el pot 2·S autoritativa (commission_for_stake).';
COMMENT ON COLUMN public.matches.winner_user_id IS 'auth.users id del jugador ganador tras resolver.';
COMMENT ON COLUMN public.matches.payout_winner_numeric IS '2·S·(1−fee) efectivo liquidado al ganador.';
COMMENT ON COLUMN public.matches.protocol_fee_total IS '2·S·fee al protocolo (tesorería) para conciliación.';

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

  IF m.status = 'completed' AND m.winner_user_id IS NOT NULL THEN
    v_won := (m.winner_user_id = v_uid);
    v_pay_all := COALESCE(
      m.payout_winner_numeric,
      (2::numeric * m.stake_amount::numeric * (1::numeric - m.commission_decimal))
    );
    v_fee_total := COALESCE(
      m.protocol_fee_total,
      (2::numeric * m.stake_amount::numeric * m.commission_decimal)
    );
    v_payout := CASE WHEN v_won THEN v_pay_all ELSE 0::numeric END;
    RETURN jsonb_build_object(
      'won', v_won,
      'payout', v_payout,
      'winner_id', m.winner_user_id,
      'commission_decimal', m.commission_decimal,
      'stake_amount', m.stake_amount,
      'match_id', p_match_id,
      'already_resolved', true,
      'payout_winner_numeric', COALESCE(m.payout_winner_numeric, v_pay_all),
      'protocol_fee_total', COALESCE(m.protocol_fee_total, v_fee_total)
    );
  END IF;

  IF m.status <> 'in_progress' THEN
    RAISE EXCEPTION 'Match not in progress';
  END IF;

  v_winner := CASE WHEN random() < 0.5 THEN m.player_one_id ELSE m.player_two_id END;
  v_won := (v_winner = v_uid);
  v_pay_all := 2::numeric * m.stake_amount::numeric * (1::numeric - m.commission_decimal);
  v_fee_total := 2::numeric * m.stake_amount::numeric * m.commission_decimal;
  v_payout := CASE WHEN v_won THEN v_pay_all ELSE 0::numeric END;

  UPDATE public.matches AS x
  SET
    winner_user_id = v_winner,
    status = 'completed',
    completed_at = now(),
    payout_winner_numeric = v_pay_all,
    protocol_fee_total = v_fee_total
  WHERE x.id = p_match_id;

  RETURN jsonb_build_object(
    'won', v_won,
    'payout', v_payout,
    'winner_id', v_winner,
    'commission_decimal', m.commission_decimal,
    'stake_amount', m.stake_amount,
    'match_id', p_match_id,
    'already_resolved', false,
    'payout_winner_numeric', v_pay_all,
    'protocol_fee_total', v_fee_total
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_match_round(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_match_round(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_match_round(uuid) TO service_role;
