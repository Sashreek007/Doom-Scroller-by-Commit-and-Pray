-- Row Level Security Policies for DoomScroller

-- ============ PROFILES ============
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can search/view public profiles
CREATE POLICY "Public profiles visible to authenticated users"
    ON public.profiles FOR SELECT
    USING (
        auth.role() = 'authenticated'
        AND (
            -- Always see your own profile
            id = auth.uid()
            -- See public profiles
            OR is_public = true
            -- See private profiles if you're friends
            OR EXISTS (
                SELECT 1 FROM public.friendships
                WHERE status = 'accepted'
                AND (
                    (requester_id = auth.uid() AND addressee_id = profiles.id)
                    OR (addressee_id = auth.uid() AND requester_id = profiles.id)
                )
            )
        )
    );

-- Users can update only their own profile
CREATE POLICY "Users can update own profile"
    ON public.profiles FOR UPDATE
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

-- Profile creation handled by trigger (SECURITY DEFINER), no direct insert needed

-- ============ SCROLL SESSIONS ============
ALTER TABLE public.scroll_sessions ENABLE ROW LEVEL SECURITY;

-- Users can only read their own scroll data
CREATE POLICY "Users read own scroll data"
    ON public.scroll_sessions FOR SELECT
    USING (auth.uid() = user_id);

-- Users can only insert their own scroll data
CREATE POLICY "Users insert own scroll data"
    ON public.scroll_sessions FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- ============ FRIENDSHIPS ============
ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;

-- Users can see friendships they're part of
CREATE POLICY "Users see own friendships"
    ON public.friendships FOR SELECT
    USING (
        auth.uid() = requester_id
        OR auth.uid() = addressee_id
    );

-- Users can send friend requests (as requester)
CREATE POLICY "Users can send friend requests"
    ON public.friendships FOR INSERT
    WITH CHECK (auth.uid() = requester_id);

-- Users can update friendships they received (accept/reject)
CREATE POLICY "Addressee can respond to friend requests"
    ON public.friendships FOR UPDATE
    USING (auth.uid() = addressee_id)
    WITH CHECK (auth.uid() = addressee_id);

-- Users can delete friendships they're part of (unfriend)
CREATE POLICY "Users can delete own friendships"
    ON public.friendships FOR DELETE
    USING (
        auth.uid() = requester_id
        OR auth.uid() = addressee_id
    );

-- ============ ACHIEVEMENTS ============
ALTER TABLE public.achievements ENABLE ROW LEVEL SECURITY;

-- Users can see their own achievements
CREATE POLICY "Users read own achievements"
    ON public.achievements FOR SELECT
    USING (auth.uid() = user_id);

-- Achievements on public profiles are visible to all authenticated users
CREATE POLICY "Public achievements visible"
    ON public.achievements FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = achievements.user_id
            AND profiles.is_public = true
        )
    );

-- Achievement creation happens via Edge Functions (service role), not direct insert
-- But allow insert for the user's own achievements for flexibility
CREATE POLICY "Users can insert own achievements"
    ON public.achievements FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- ============ CHAT MESSAGES ============
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

-- Users can only see their own chat messages
CREATE POLICY "Users read own chat messages"
    ON public.chat_messages FOR SELECT
    USING (auth.uid() = user_id);

-- Users can insert their own chat messages
CREATE POLICY "Users insert own chat messages"
    ON public.chat_messages FOR INSERT
    WITH CHECK (auth.uid() = user_id);
