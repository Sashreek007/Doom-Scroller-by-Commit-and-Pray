-- Split profile visibility into world-level and friends-level controls.
-- Keeps legacy is_public for backward compatibility.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS world_public BOOLEAN,
  ADD COLUMN IF NOT EXISTS friends_public BOOLEAN;

UPDATE public.profiles
SET
  world_public = COALESCE(world_public, is_public, true),
  friends_public = COALESCE(friends_public, true);

ALTER TABLE public.profiles
  ALTER COLUMN world_public SET DEFAULT true,
  ALTER COLUMN world_public SET NOT NULL,
  ALTER COLUMN friends_public SET DEFAULT true,
  ALTER COLUMN friends_public SET NOT NULL;

-- Keep legacy field in sync for older clients still reading is_public.
UPDATE public.profiles
SET is_public = world_public
WHERE is_public IS DISTINCT FROM world_public;

CREATE OR REPLACE FUNCTION public.sync_profile_world_public_legacy()
RETURNS TRIGGER AS $$
BEGIN
  NEW.is_public := COALESCE(NEW.world_public, true);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS profiles_sync_legacy_public ON public.profiles;
CREATE TRIGGER profiles_sync_legacy_public
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_profile_world_public_legacy();

CREATE INDEX IF NOT EXISTS idx_profiles_world_public_meters
  ON public.profiles(world_public, total_meters_scrolled DESC);

CREATE INDEX IF NOT EXISTS idx_profiles_friends_public
  ON public.profiles(friends_public);

CREATE OR REPLACE FUNCTION public.are_friends(user_a UUID, user_b UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    CASE
      WHEN user_a IS NULL OR user_b IS NULL THEN FALSE
      ELSE EXISTS (
        SELECT 1
        FROM public.friendships f
        WHERE f.status = 'accepted'
          AND (
            (f.requester_id = user_a AND f.addressee_id = user_b)
            OR (f.requester_id = user_b AND f.addressee_id = user_a)
          )
      )
    END;
$$;

REVOKE ALL ON FUNCTION public.are_friends(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.are_friends(UUID, UUID) TO authenticated;

DROP POLICY IF EXISTS "Public profiles visible to authenticated users" ON public.profiles;
CREATE POLICY "Profiles visible by world/friends visibility"
  ON public.profiles FOR SELECT
  USING (
    auth.role() = 'authenticated'
    AND (
      id = auth.uid()
      OR world_public = true
      OR (
        friends_public = true
        AND public.are_friends(auth.uid(), profiles.id)
      )
    )
  );

DROP POLICY IF EXISTS "Public achievements visible" ON public.achievements;
CREATE POLICY "Achievements visible by profile visibility"
  ON public.achievements FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = achievements.user_id
        AND (
          p.id = auth.uid()
          OR p.world_public = true
          OR (
            p.friends_public = true
            AND public.are_friends(auth.uid(), p.id)
          )
        )
    )
  );

DROP MATERIALIZED VIEW IF EXISTS public.leaderboard_world CASCADE;
CREATE MATERIALIZED VIEW public.leaderboard_world AS
SELECT
  p.id AS user_id,
  p.username,
  p.display_name,
  p.avatar_url,
  COALESCE(p.total_meters_scrolled, 0) AS total_meters,
  RANK() OVER (ORDER BY COALESCE(p.total_meters_scrolled, 0) DESC) AS rank
FROM public.profiles p
WHERE p.world_public = true
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS idx_leaderboard_world_user
  ON public.leaderboard_world(user_id);
CREATE INDEX IF NOT EXISTS idx_leaderboard_world_rank
  ON public.leaderboard_world(rank);
GRANT SELECT ON public.leaderboard_world TO authenticated;

CREATE OR REPLACE FUNCTION public.refresh_leaderboard()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.leaderboard_world;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Directory for social interactions (friend requests, pending lists, battle roster)
-- Returns minimal profile card info and hides totals unless viewer has visibility.
CREATE OR REPLACE FUNCTION public.get_social_profiles(profile_ids UUID[])
RETURNS TABLE (
  id UUID,
  username TEXT,
  display_name TEXT,
  avatar_url TEXT,
  total_meters_scrolled NUMERIC,
  created_at TIMESTAMPTZ,
  is_public BOOLEAN,
  world_public BOOLEAN,
  friends_public BOOLEAN,
  can_view_details BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.username,
    p.display_name,
    p.avatar_url,
    CASE
      WHEN (
        p.id = auth.uid()
        OR p.world_public = true
        OR (p.friends_public = true AND public.are_friends(auth.uid(), p.id))
      )
      THEN COALESCE(p.total_meters_scrolled, 0)
      ELSE 0
    END AS total_meters_scrolled,
    p.created_at,
    p.is_public,
    p.world_public,
    p.friends_public,
    (
      p.id = auth.uid()
      OR p.world_public = true
      OR (p.friends_public = true AND public.are_friends(auth.uid(), p.id))
    ) AS can_view_details
  FROM public.profiles p
  WHERE p.id = ANY(COALESCE(profile_ids, ARRAY[]::UUID[]));
$$;

REVOKE ALL ON FUNCTION public.get_social_profiles(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_social_profiles(UUID[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.search_profiles_for_friend_requests(search_query TEXT, result_limit INTEGER DEFAULT 40)
RETURNS TABLE (
  id UUID,
  username TEXT,
  display_name TEXT,
  avatar_url TEXT,
  total_meters_scrolled NUMERIC,
  created_at TIMESTAMPTZ,
  is_public BOOLEAN,
  world_public BOOLEAN,
  friends_public BOOLEAN,
  can_view_details BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH input AS (
    SELECT
      auth.uid() AS viewer_id,
      LOWER(TRIM(COALESCE(search_query, ''))) AS q,
      LEAST(GREATEST(COALESCE(result_limit, 40), 1), 100) AS lim
  )
  SELECT
    p.id,
    p.username,
    p.display_name,
    p.avatar_url,
    CASE
      WHEN (
        p.id = i.viewer_id
        OR p.world_public = true
        OR (p.friends_public = true AND public.are_friends(i.viewer_id, p.id))
      )
      THEN COALESCE(p.total_meters_scrolled, 0)
      ELSE 0
    END AS total_meters_scrolled,
    p.created_at,
    p.is_public,
    p.world_public,
    p.friends_public,
    (
      p.id = i.viewer_id
      OR p.world_public = true
      OR (p.friends_public = true AND public.are_friends(i.viewer_id, p.id))
    ) AS can_view_details
  FROM public.profiles p
  CROSS JOIN input i
  WHERE p.id <> i.viewer_id
    AND (
      i.q = ''
      OR p.username ILIKE '%' || i.q || '%'
      OR p.display_name ILIKE '%' || i.q || '%'
    )
  ORDER BY
    p.world_public DESC,
    p.username ASC
  LIMIT (SELECT lim FROM input);
$$;

REVOKE ALL ON FUNCTION public.search_profiles_for_friend_requests(TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_profiles_for_friend_requests(TEXT, INTEGER) TO authenticated;
