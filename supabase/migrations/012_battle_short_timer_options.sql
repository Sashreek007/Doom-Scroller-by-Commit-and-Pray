-- Allow short battle rounds (10s / 20s) for quick room games.

ALTER TABLE public.battle_rooms
  DROP CONSTRAINT IF EXISTS battle_rooms_timer_seconds_check;

ALTER TABLE public.battle_rooms
  ADD CONSTRAINT battle_rooms_timer_seconds_check
  CHECK (timer_seconds >= 10 AND timer_seconds <= 900);
