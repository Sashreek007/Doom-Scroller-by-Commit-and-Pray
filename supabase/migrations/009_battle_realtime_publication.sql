-- Ensure battle tables are included in supabase_realtime publication.
-- Needed for deployments where 007 ran before publication wiring was added.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'battle_rooms'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.battle_rooms;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'battle_room_members'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.battle_room_members;
  END IF;
END $$;
