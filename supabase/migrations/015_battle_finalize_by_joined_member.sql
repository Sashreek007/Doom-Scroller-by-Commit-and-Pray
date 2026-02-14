-- Allow any joined member to finalize a due round.
-- This ensures round settlement and result overlays still happen when host popup is closed.

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
  caller_joined BOOLEAN;
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

  SELECT EXISTS (
    SELECT 1
    FROM public.battle_room_members m
    WHERE m.room_id = p_room_id
      AND m.user_id = auth.uid()
      AND m.status = 'joined'
  )
  INTO caller_joined;

  IF NOT caller_joined THEN
    RAISE EXCEPTION 'Only joined players can finalize round';
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

GRANT EXECUTE ON FUNCTION public.finalize_battle_round(UUID) TO authenticated;
