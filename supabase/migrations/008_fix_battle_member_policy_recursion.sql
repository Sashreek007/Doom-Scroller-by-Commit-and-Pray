-- Fix RLS recursion on battle_room_members.
-- The previous SELECT policy queried battle_room_members inside itself,
-- which triggers "infinite recursion detected in policy".

CREATE OR REPLACE FUNCTION public.is_joined_battle_member(target_room_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.battle_room_members m
    WHERE m.room_id = target_room_id
      AND m.user_id = auth.uid()
      AND m.status = 'joined'
  );
$$;

REVOKE ALL ON FUNCTION public.is_joined_battle_member(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_joined_battle_member(UUID) TO authenticated;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'battle_room_members'
      AND policyname = 'Battle room members visible to participants'
  ) THEN
    DROP POLICY "Battle room members visible to participants" ON public.battle_room_members;
  END IF;
END $$;

CREATE POLICY "Battle room members visible to participants"
  ON public.battle_room_members FOR SELECT
  USING (
    auth.uid() = user_id
    OR public.is_joined_battle_member(room_id)
  );
