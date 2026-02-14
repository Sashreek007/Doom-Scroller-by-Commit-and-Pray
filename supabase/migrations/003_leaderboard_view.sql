-- Materialized view for world leaderboard (only public profiles)
-- Refresh via pg_cron every 5 minutes

CREATE MATERIALIZED VIEW IF NOT EXISTS leaderboard_world AS
SELECT
    p.id AS user_id,
    p.username,
    p.display_name,
    p.avatar_url,
    COALESCE(p.total_meters_scrolled, 0) AS total_meters,
    RANK() OVER (ORDER BY COALESCE(p.total_meters_scrolled, 0) DESC) AS rank
FROM public.profiles p
WHERE p.is_public = true
WITH DATA;

-- Index for fast rank lookups
CREATE UNIQUE INDEX idx_leaderboard_world_user ON leaderboard_world(user_id);
CREATE INDEX idx_leaderboard_world_rank ON leaderboard_world(rank);

-- Function to refresh leaderboard (called by pg_cron or manually)
CREATE OR REPLACE FUNCTION refresh_leaderboard()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY leaderboard_world;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
