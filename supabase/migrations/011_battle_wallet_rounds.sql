-- Wallet-backed coins + battle round settlement
-- Adds coin balance fields and atomic battle round start/finalize RPCs.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS coin_balance BIGINT,
  ADD COLUMN IF NOT EXISTS coin_meter_checkpoint NUMERIC(12,2);

UPDATE public.profiles
SET
  coin_balance = FLOOR(COALESCE(total_meters_scrolled, 0) / 20)::BIGINT,
  coin_meter_checkpoint = FLOOR(COALESCE(total_meters_scrolled, 0) / 20) * 20
WHERE coin_balance IS NULL OR coin_meter_checkpoint IS NULL;

ALTER TABLE public.profiles
  ALTER COLUMN coin_balance SET DEFAULT 0,
  ALTER COLUMN coin_balance SET NOT NULL,
  ALTER COLUMN coin_meter_checkpoint SET DEFAULT 0,
  ALTER COLUMN coin_meter_checkpoint SET NOT NULL;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_coin_balance_non_negative;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_coin_balance_non_negative
  CHECK (coin_balance >= 0 AND coin_meter_checkpoint >= 0);

-- Extend profile-updating trigger function to also award scroll-earned coins.
CREATE OR REPLACE FUNCTION public.update_total_meters()
RETURNS TRIGGER AS $$
DECLARE
    next_total NUMERIC(12,2);
    checkpoint NUMERIC(12,2);
    earned_coins BIGINT;
BEGIN
    UPDATE public.profiles
    SET total_meters_scrolled = total_meters_scrolled + NEW.meters_scrolled
    WHERE id = NEW.user_id
    RETURNING total_meters_scrolled, coin_meter_checkpoint
    INTO next_total, checkpoint;

    IF next_total IS NULL THEN
      RETURN NEW;
    END IF;

    checkpoint := COALESCE(checkpoint, 0);
    earned_coins := FLOOR(GREATEST(next_total - checkpoint, 0) / 20);

    IF earned_coins > 0 THEN
      UPDATE public.profiles
      SET
        coin_balance = coin_balance + earned_coins,
        coin_meter_checkpoint = checkpoint + (earned_coins * 20)
      WHERE id = NEW.user_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

ALTER TABLE public.battle_room_members
  ADD COLUMN IF NOT EXISTS round_start_meters NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS round_score_meters NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE public.battle_rooms
  ADD COLUMN IF NOT EXISTS round_result JSONB;

CREATE OR REPLACE FUNCTION public.start_battle_round(
  p_room_id UUID,
  p_prestart_seconds INTEGER DEFAULT 8
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  room_row public.battle_rooms%ROWTYPE;
  joined_count INTEGER;
  start_at TIMESTAMPTZ;
  end_at TIMESTAMPTZ;
  min_balance BIGINT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO room_row
  FROM public.battle_rooms
  WHERE id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Room not found';
  END IF;

  IF room_row.host_id <> auth.uid() THEN
    RAISE EXCEPTION 'Only host can start round';
  END IF;

  IF room_row.selected_game_type IS NULL THEN
    RAISE EXCEPTION 'Select game type first';
  END IF;

  IF room_row.status <> 'game_select' THEN
    RAISE EXCEPTION 'Room must be in game_select state';
  END IF;

  SELECT COUNT(*) INTO joined_count
  FROM public.battle_room_members
  WHERE room_id = p_room_id
    AND status = 'joined';

  IF joined_count < 2 THEN
    RAISE EXCEPTION 'Need at least 2 players';
  END IF;

  IF joined_count > room_row.max_players THEN
    RAISE EXCEPTION 'Room exceeds max players';
  END IF;

  SELECT MIN(p.coin_balance) INTO min_balance
  FROM public.battle_room_members m
  JOIN public.profiles p ON p.id = m.user_id
  WHERE m.room_id = p_room_id
    AND m.status = 'joined';

  IF min_balance IS NULL THEN
    RAISE EXCEPTION 'No joined players';
  END IF;

  IF min_balance < room_row.bet_coins THEN
    RAISE EXCEPTION 'Some players do not have enough coins for this bet';
  END IF;

  start_at := now() + make_interval(secs => GREATEST(1, LEAST(COALESCE(p_prestart_seconds, 8), 30)));
  end_at := start_at + make_interval(secs => room_row.timer_seconds);

  UPDATE public.battle_room_members m
  SET
    round_start_meters = COALESCE(p.total_meters_scrolled, 0),
    round_score_meters = 0
  FROM public.profiles p
  WHERE m.room_id = p_room_id
    AND m.status = 'joined'
    AND p.id = m.user_id;

  UPDATE public.battle_rooms
  SET
    status = 'active',
    round_started_at = start_at,
    round_ends_at = end_at,
    round_result = NULL
  WHERE id = p_room_id;

  RETURN jsonb_build_object(
    'roomId', p_room_id,
    'status', 'active',
    'roundStartedAt', start_at,
    'roundEndsAt', end_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_battle_round(
  p_room_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  room_row public.battle_rooms%ROWTYPE;
  max_score NUMERIC(12,2);
  player_count INTEGER;
  winner_count INTEGER;
  pot BIGINT;
  share BIGINT;
  remainder BIGINT;
  lead_winner UUID;
  result_payload JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO room_row
  FROM public.battle_rooms
  WHERE id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Room not found';
  END IF;

  IF room_row.host_id <> auth.uid() THEN
    RAISE EXCEPTION 'Only host can finalize round';
  END IF;

  IF room_row.status <> 'active' THEN
    RAISE EXCEPTION 'Round is not active';
  END IF;

  IF room_row.round_ends_at IS NULL OR now() < room_row.round_ends_at THEN
    RAISE EXCEPTION 'Round timer has not completed';
  END IF;

  CREATE TEMP TABLE _battle_scores ON COMMIT DROP AS
  SELECT
    m.user_id,
    m.joined_at,
    GREATEST(COALESCE(p.total_meters_scrolled, 0) - COALESCE(m.round_start_meters, 0), 0)::NUMERIC(12,2) AS score
  FROM public.battle_room_members m
  JOIN public.profiles p ON p.id = m.user_id
  WHERE m.room_id = p_room_id
    AND m.status = 'joined';

  SELECT COUNT(*) INTO player_count FROM _battle_scores;
  IF player_count < 1 THEN
    RAISE EXCEPTION 'No joined players to settle';
  END IF;

  SELECT COALESCE(MAX(score), 0) INTO max_score FROM _battle_scores;

  CREATE TEMP TABLE _battle_winners ON COMMIT DROP AS
  SELECT user_id, joined_at, score
  FROM _battle_scores
  WHERE score = max_score
  ORDER BY joined_at ASC, user_id ASC;

  SELECT COUNT(*) INTO winner_count FROM _battle_winners;
  IF winner_count < 1 THEN
    RAISE EXCEPTION 'No winner computed';
  END IF;

  pot := room_row.bet_coins::BIGINT * player_count::BIGINT;
  share := FLOOR(pot::NUMERIC / winner_count::NUMERIC);
  remainder := pot - (share * winner_count);

  UPDATE public.profiles p
  SET coin_balance = GREATEST(0, p.coin_balance - room_row.bet_coins)
  FROM _battle_scores s
  WHERE p.id = s.user_id;

  UPDATE public.profiles p
  SET coin_balance = p.coin_balance + share
  FROM _battle_winners w
  WHERE p.id = w.user_id;

  IF remainder > 0 THEN
    SELECT user_id INTO lead_winner
    FROM _battle_winners
    ORDER BY joined_at ASC, user_id ASC
    LIMIT 1;

    UPDATE public.profiles
    SET coin_balance = coin_balance + remainder
    WHERE id = lead_winner;
  END IF;

  UPDATE public.battle_room_members m
  SET round_score_meters = s.score
  FROM _battle_scores s
  WHERE m.room_id = p_room_id
    AND m.user_id = s.user_id;

  result_payload := jsonb_build_object(
    'settledAt', now(),
    'pot', pot,
    'betCoins', room_row.bet_coins,
    'winnerIds', COALESCE((SELECT jsonb_agg(w.user_id ORDER BY w.joined_at ASC, w.user_id ASC) FROM _battle_winners w), '[]'::jsonb),
    'scores', COALESCE((SELECT jsonb_object_agg(s.user_id::TEXT, s.score) FROM _battle_scores s), '{}'::jsonb),
    'payouts', COALESCE((
      SELECT jsonb_object_agg(s.user_id::TEXT, (
        CASE WHEN EXISTS (SELECT 1 FROM _battle_winners w WHERE w.user_id = s.user_id) THEN
          (-room_row.bet_coins + share + CASE WHEN remainder > 0 AND s.user_id = lead_winner THEN remainder ELSE 0 END)
        ELSE
          -room_row.bet_coins
        END
      ))
      FROM _battle_scores s
    ), '{}'::jsonb)
  );

  UPDATE public.battle_rooms
  SET
    status = 'game_select',
    round_started_at = NULL,
    round_ends_at = NULL,
    round_result = result_payload
  WHERE id = p_room_id;

  RETURN result_payload;
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_battle_round(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_battle_round(UUID) TO authenticated;
