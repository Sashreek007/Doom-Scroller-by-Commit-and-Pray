-- Remove deprecated App Lockdown mode from battle game types.
-- Keep existing rows valid by remapping old values before tightening constraints.

UPDATE public.battle_rooms
SET selected_game_type = 'scroll_sprint'
WHERE selected_game_type = 'app_lockdown';

ALTER TABLE public.battle_rooms
  DROP CONSTRAINT IF EXISTS battle_rooms_selected_game_type_check;

ALTER TABLE public.battle_rooms
  ADD CONSTRAINT battle_rooms_selected_game_type_check
  CHECK (
    selected_game_type IS NULL
    OR selected_game_type IN ('scroll_sprint', 'target_chase')
  );
