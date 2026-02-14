-- Ensure profile visibility is public by default.
-- Also backfill existing rows so private/null profiles become public.

UPDATE public.profiles
SET is_public = true
WHERE is_public IS DISTINCT FROM true;

ALTER TABLE public.profiles
ALTER COLUMN is_public SET DEFAULT true;

ALTER TABLE public.profiles
ALTER COLUMN is_public SET NOT NULL;
