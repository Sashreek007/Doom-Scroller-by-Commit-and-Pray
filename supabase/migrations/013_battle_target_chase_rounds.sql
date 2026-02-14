-- Implement Target Chase battle mode:
-- - Generates a per-round target distance.
-- - Finalizes winners by closest distance to target.
-- - Preserves existing Scroll Sprint behavior.

ALTER TABLE public.battle_rooms
  ADD COLUMN IF NOT EXISTS round_target_meters NUMERIC(12,2);

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
  target_meters NUMERIC(12,2);
  base_target NUMERIC(12,2);
  spread NUMERIC(12,2);
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

  IF room_row.selected_game_type = 'target_chase' THEN
    base_target := GREATEST(2::NUMERIC, room_row.timer_seconds::NUMERIC * 0.08);
    spread := GREATEST(1::NUMERIC, base_target * 0.25);
    target_meters := ROUND((base_target + (((random() * 2 - 1)::NUMERIC) * spread))::NUMERIC, 1);
    target_meters := GREATEST(1::NUMERIC, target_meters);
  ELSE
    target_meters := NULL;
  END IF;

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
    round_target_meters = target_meters,
    round_result = NULL
  WHERE id = p_room_id;

  RETURN jsonb_build_object(
    'roomId', p_room_id,
    'status', 'active',
    'roundStartedAt', start_at,
    'roundEndsAt', end_at,
    'targetMeters', target_meters
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
  min_off_by NUMERIC(12,2);
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

  IF room_row.selected_game_type = 'target_chase' THEN
    IF room_row.round_target_meters IS NULL THEN
      RAISE EXCEPTION 'Target distance missing for target_chase';
    END IF;

    SELECT COALESCE(MIN(ABS(score - room_row.round_target_meters)), 0)
    INTO min_off_by
    FROM _battle_scores;

    CREATE TEMP TABLE _battle_winners ON COMMIT DROP AS
    SELECT user_id, joined_at, score
    FROM _battle_scores
    WHERE ABS(score - room_row.round_target_meters) = min_off_by
    ORDER BY joined_at ASC, user_id ASC;
  ELSE
    SELECT COALESCE(MAX(score), 0) INTO max_score FROM _battle_scores;

    CREATE TEMP TABLE _battle_winners ON COMMIT DROP AS
    SELECT user_id, joined_at, score
    FROM _battle_scores
    WHERE score = max_score
    ORDER BY joined_at ASC, user_id ASC;
  END IF;

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
    'offBy', CASE
      WHEN room_row.selected_game_type = 'target_chase' THEN
        COALESCE((SELECT jsonb_object_agg(s.user_id::TEXT, ABS(s.score - room_row.round_target_meters)) FROM _battle_scores s), '{}'::jsonb)
      ELSE '{}'::jsonb
    END,
    'targetMeters', CASE
      WHEN room_row.selected_game_type = 'target_chase' THEN room_row.round_target_meters
      ELSE NULL
    END,
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
    round_target_meters = NULL,
    round_result = result_payload
  WHERE id = p_room_id;

  RETURN result_payload;
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_battle_round(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_battle_round(UUID) TO authenticated;
