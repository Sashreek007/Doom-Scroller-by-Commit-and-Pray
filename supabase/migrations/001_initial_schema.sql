-- DoomScroller Initial Schema
-- Tables: profiles, scroll_sessions, friendships, achievements

-- ============ PROFILES ============
-- Extends Supabase auth.users with public profile data
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    avatar_url TEXT,
    is_public BOOLEAN DEFAULT true,
    total_meters_scrolled NUMERIC(12,2) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),

    -- Username constraints: lowercase, 3-20 chars, alphanumeric + underscores
    CONSTRAINT username_format CHECK (
        username ~ '^[a-z0-9_]{3,20}$'
    )
);

-- Auto-create profile when a new user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    base_name TEXT;
BEGIN
    -- Replace non-alphanumeric chars with underscore, truncate to 15 chars to leave room for suffix
    base_name := LEFT(REGEXP_REPLACE(LOWER(SPLIT_PART(NEW.email, '@', 1)), '[^a-z0-9]', '_', 'g'), 15);

    INSERT INTO public.profiles (id, username, display_name)
    VALUES (
        NEW.id,
        base_name || '_' || SUBSTR(MD5(RANDOM()::TEXT), 1, 4),
        COALESCE(NEW.raw_user_meta_data->>'display_name', SPLIT_PART(NEW.email, '@', 1))
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Update updated_at on profile changes
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============ SCROLL SESSIONS ============
CREATE TABLE public.scroll_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    site TEXT NOT NULL,
    pixels_scrolled BIGINT NOT NULL,
    meters_scrolled NUMERIC(10,4) NOT NULL,
    duration_seconds INTEGER NOT NULL,
    session_start TIMESTAMPTZ NOT NULL,
    session_end TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_scroll_sessions_user_id ON public.scroll_sessions(user_id);
CREATE INDEX idx_scroll_sessions_created ON public.scroll_sessions(created_at);
CREATE INDEX idx_scroll_sessions_user_date ON public.scroll_sessions(user_id, created_at);

-- Trigger to update total_meters_scrolled on profiles after new scroll session
CREATE OR REPLACE FUNCTION public.update_total_meters()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE public.profiles
    SET total_meters_scrolled = total_meters_scrolled + NEW.meters_scrolled
    WHERE id = NEW.user_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_scroll_session_insert
    AFTER INSERT ON public.scroll_sessions
    FOR EACH ROW EXECUTE FUNCTION public.update_total_meters();

-- ============ FRIENDSHIPS ============
CREATE TABLE public.friendships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    requester_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    addressee_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'accepted', 'rejected')),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),

    -- Prevent duplicate friend requests (in either direction)
    CONSTRAINT unique_friendship UNIQUE (requester_id, addressee_id),
    -- Prevent self-friending
    CONSTRAINT no_self_friend CHECK (requester_id != addressee_id)
);

CREATE INDEX idx_friendships_requester ON public.friendships(requester_id);
CREATE INDEX idx_friendships_addressee ON public.friendships(addressee_id);

CREATE TRIGGER friendships_updated_at
    BEFORE UPDATE ON public.friendships
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============ ACHIEVEMENTS ============
CREATE TABLE public.achievements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    trigger_type TEXT NOT NULL,
    trigger_value NUMERIC NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    icon TEXT DEFAULT '🏆',
    earned_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_achievements_user ON public.achievements(user_id);

-- ============ CHAT MESSAGES ============
CREATE TABLE public.chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_chat_messages_user ON public.chat_messages(user_id, created_at);
