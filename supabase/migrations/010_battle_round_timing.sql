-- Round timing fields so all players see synchronized pre-start and live timer.

ALTER TABLE public.battle_rooms
  ADD COLUMN IF NOT EXISTS round_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS round_ends_at TIMESTAMPTZ;

ALTER TABLE public.battle_rooms
  DROP CONSTRAINT IF EXISTS battle_rooms_round_time_check;

ALTER TABLE public.battle_rooms
  ADD CONSTRAINT battle_rooms_round_time_check
  CHECK (
    (round_started_at IS NULL AND round_ends_at IS NULL)
    OR (round_started_at IS NOT NULL AND round_ends_at IS NOT NULL AND round_ends_at > round_started_at)
  );
