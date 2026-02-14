-- v2 achievements metadata (additive, non-breaking)

ALTER TABLE public.achievements
  ADD COLUMN IF NOT EXISTS event_key TEXT,
  ADD COLUMN IF NOT EXISTS rarity TEXT,
  ADD COLUMN IF NOT EXISTS app_scope TEXT,
  ADD COLUMN IF NOT EXISTS meta JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'rule+ai';

ALTER TABLE public.achievements
  DROP CONSTRAINT IF EXISTS achievements_rarity_check;

ALTER TABLE public.achievements
  ADD CONSTRAINT achievements_rarity_check
  CHECK (rarity IS NULL OR rarity IN ('common', 'rare', 'epic', 'legendary'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_achievements_user_event_key_unique
  ON public.achievements(user_id, event_key)
  WHERE event_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_achievements_user_earned_desc
  ON public.achievements(user_id, earned_at DESC);

CREATE INDEX IF NOT EXISTS idx_achievements_user_app_scope
  ON public.achievements(user_id, app_scope);
