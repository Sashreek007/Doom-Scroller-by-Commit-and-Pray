-- Persistent battle rooms and membership
-- Keeps players in rooms across popup close; host can kick and host can be reassigned.

CREATE TABLE IF NOT EXISTS public.battle_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_key TEXT UNIQUE NOT NULL,
  host_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'lobby'
    CHECK (status IN ('lobby', 'game_select', 'active', 'closed')),
  bet_coins INTEGER NOT NULL DEFAULT 0 CHECK (bet_coins >= 0),
  timer_seconds INTEGER NOT NULL DEFAULT 120 CHECK (timer_seconds >= 30),
  selected_game_type TEXT NULL
    CHECK (selected_game_type IS NULL OR selected_game_type IN ('scroll_sprint', 'target_chase', 'app_lockdown')),
  max_players INTEGER NOT NULL DEFAULT 4 CHECK (max_players BETWEEN 2 AND 4),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT battle_rooms_key_format CHECK (room_key ~ '^[A-Z0-9]{6}$')
);

CREATE INDEX IF NOT EXISTS idx_battle_rooms_host_id ON public.battle_rooms(host_id);
CREATE INDEX IF NOT EXISTS idx_battle_rooms_status ON public.battle_rooms(status);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'battle_rooms_updated_at'
  ) THEN
    CREATE TRIGGER battle_rooms_updated_at
      BEFORE UPDATE ON public.battle_rooms
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.battle_room_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.battle_rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'player'
    CHECK (role IN ('host', 'player')),
  status TEXT NOT NULL DEFAULT 'joined'
    CHECK (status IN ('joined', 'left', 'kicked')),
  joined_at TIMESTAMPTZ DEFAULT now(),
  left_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT unique_room_member UNIQUE (room_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_battle_room_members_room_status
  ON public.battle_room_members(room_id, status, joined_at);
CREATE INDEX IF NOT EXISTS idx_battle_room_members_user_status
  ON public.battle_room_members(user_id, status, joined_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'battle_room_members_updated_at'
  ) THEN
    CREATE TRIGGER battle_room_members_updated_at
      BEFORE UPDATE ON public.battle_room_members
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
  END IF;
END $$;

ALTER TABLE public.battle_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.battle_room_members ENABLE ROW LEVEL SECURITY;

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

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'battle_rooms'
      AND policyname = 'Battle rooms visible to authenticated users'
  ) THEN
    CREATE POLICY "Battle rooms visible to authenticated users"
      ON public.battle_rooms FOR SELECT
      USING (auth.role() = 'authenticated');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'battle_rooms'
      AND policyname = 'Users create own battle rooms'
  ) THEN
    CREATE POLICY "Users create own battle rooms"
      ON public.battle_rooms FOR INSERT
      WITH CHECK (auth.uid() = host_id AND auth.uid() = created_by);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'battle_rooms'
      AND policyname = 'Host updates battle room'
  ) THEN
    DROP POLICY "Host updates battle room" ON public.battle_rooms;
  END IF;

  CREATE POLICY "Host updates battle room"
    ON public.battle_rooms FOR UPDATE
    USING (auth.uid() = host_id)
    WITH CHECK (
      EXISTS (
        SELECT 1
        FROM public.battle_room_members m
        WHERE m.room_id = battle_rooms.id
          AND m.user_id = battle_rooms.host_id
          AND m.status = 'joined'
      )
    );
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'battle_room_members'
      AND policyname = 'Battle room members visible to participants'
  ) THEN
    CREATE POLICY "Battle room members visible to participants"
      ON public.battle_room_members FOR SELECT
      USING (
        auth.uid() = user_id
        OR EXISTS (
          SELECT 1
          FROM public.battle_room_members my_membership
          WHERE my_membership.room_id = battle_room_members.room_id
            AND my_membership.user_id = auth.uid()
            AND my_membership.status = 'joined'
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'battle_room_members'
      AND policyname = 'Users manage own battle membership insert'
  ) THEN
    CREATE POLICY "Users manage own battle membership insert"
      ON public.battle_room_members FOR INSERT
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'battle_room_members'
      AND policyname = 'Users or host update battle membership'
  ) THEN
    CREATE POLICY "Users or host update battle membership"
      ON public.battle_room_members FOR UPDATE
      USING (
        auth.uid() = user_id
        OR EXISTS (
          SELECT 1
          FROM public.battle_rooms r
          WHERE r.id = battle_room_members.room_id
            AND r.host_id = auth.uid()
        )
      )
      WITH CHECK (
        auth.uid() = user_id
        OR EXISTS (
          SELECT 1
          FROM public.battle_rooms r
          WHERE r.id = battle_room_members.room_id
            AND r.host_id = auth.uid()
        )
      );
  END IF;
END $$;
