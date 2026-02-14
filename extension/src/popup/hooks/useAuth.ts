import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/shared/supabase';
import type { User, Session } from '@supabase/supabase-js';
import type { Profile } from '@/shared/types';
import { ensureProfileExists, fetchProfile } from '@/shared/profile';

const PROFILE_RESOLVE_TIMEOUT_MS = 10000;
const PROFILE_RESOLVE_MAX_RETRIES = 3;
const PROFILE_RETRY_DELAY_MS = 700;
const AUTH_PROFILE_CACHE_PREFIX = 'cached_auth_profile_';

interface AuthState {
  user: User | null;
  profile: Profile | null;
  session: Session | null;
  loading: boolean;
  profileError: string | null;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    profile: null,
    session: null,
    loading: true,
    profileError: null,
  });
  const loadedUserId = useRef<string | null>(null);
  const loadedProfileUserId = useRef<string | null>(null);

  const getProfileCacheKey = useCallback((userId: string) => `${AUTH_PROFILE_CACHE_PREFIX}${userId}`, []);

  const readCachedProfile = useCallback(async (userId: string): Promise<Profile | null> => {
    try {
      const key = getProfileCacheKey(userId);
      const result = await chrome.storage.local.get(key);
      const cached = result[key] as Profile | undefined;
      if (cached && cached.id === userId) return cached;
    } catch {
      // Ignore cache read issues and continue with network resolution.
    }
    return null;
  }, [getProfileCacheKey]);

  const writeCachedProfile = useCallback(async (profile: Profile) => {
    try {
      const key = getProfileCacheKey(profile.id);
      await chrome.storage.local.set({ [key]: profile });
    } catch {
      // Ignore cache write issues; DB remains source of truth.
    }
  }, [getProfileCacheKey]);

  const ensureProfilePublic = useCallback(async (profile: Profile | null): Promise<Profile | null> => {
    if (!profile || profile.is_public) return profile;
    const { data, error } = await supabase
      .from('profiles')
      .update({ is_public: true })
      .eq('id', profile.id)
      .select('*')
      .single();
    if (error) {
      console.warn('[DoomScroller] ensureProfilePublic error:', error.message);
      return profile;
    }
    return data as Profile;
  }, []);

  const resolveProfile = useCallback(async (user: User): Promise<Profile | null> => {
    const profile = await ensureProfileExists(supabase, user);
    const publicProfile = await ensureProfilePublic(profile).catch(() => profile);
    return publicProfile;
  }, [ensureProfilePublic]);

  const resolveProfileWithTimeout = useCallback(async (
    user: User,
  ): Promise<{ profile: Profile | null; timedOut: boolean }> => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    try {
      const timeoutPromise = new Promise<{ profile: null; timedOut: true }>((resolve) => {
        timeoutId = setTimeout(() => resolve({ profile: null, timedOut: true }), PROFILE_RESOLVE_TIMEOUT_MS);
      });
      const profilePromise = resolveProfile(user).then((profile) => ({ profile, timedOut: false as const }));
      return await Promise.race([profilePromise, timeoutPromise]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }, [resolveProfile]);

  const wait = useCallback((ms: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  }), []);

  const resolveProfileRobust = useCallback(async (
    user: User,
  ): Promise<{ profile: Profile | null; timedOut: boolean }> => {
    let last: { profile: Profile | null; timedOut: boolean } = { profile: null, timedOut: false };
    for (let attempt = 0; attempt < PROFILE_RESOLVE_MAX_RETRIES; attempt += 1) {
      last = await resolveProfileWithTimeout(user).catch(() => ({ profile: null, timedOut: false }));
      if (last.profile) return last;
      if (attempt < PROFILE_RESOLVE_MAX_RETRIES - 1) {
        await wait(PROFILE_RETRY_DELAY_MS * (attempt + 1));
      }
    }
    return last;
  }, [resolveProfileWithTimeout, wait]);

  useEffect(() => {
    let mounted = true;

    async function loadSession(session: Session | null) {
      if (!mounted) return;
      if (session?.user) {
        const userId = session.user.id;
        const userChanged = loadedUserId.current !== userId;

        loadedUserId.current = userId;
        if (userChanged) loadedProfileUserId.current = null;

        setState((prev) => ({
          ...prev,
          user: session.user,
          session,
          loading: false,
          profile: userChanged ? null : prev.profile,
          profileError: userChanged ? null : prev.profileError,
        }));

        const cachedProfile = await readCachedProfile(userId);
        if (cachedProfile && mounted) {
          setState((prev) => {
            if (prev.user?.id !== userId) return prev;
            if (prev.profile && !userChanged) return prev;
            return { ...prev, profile: cachedProfile, profileError: null };
          });
        }

        if (loadedProfileUserId.current === userId) return;

        const { profile, timedOut } = await resolveProfileRobust(session.user);
        if (!mounted) return;
        if (profile) {
          loadedProfileUserId.current = userId;
          void writeCachedProfile(profile);
          setState((prev) => ({ ...prev, profile, profileError: null }));
        } else {
          setState((prev) => ({
            ...prev,
            profile: null,
            profileError: timedOut
              ? 'Profile sync timed out. Check connection and retry.'
              : 'Could not load your profile from the database.',
          }));
        }
      } else {
        loadedUserId.current = null;
        loadedProfileUserId.current = null;
        setState({ user: null, profile: null, session: null, loading: false, profileError: null });
      }
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      // Avoid async work directly in callback; run it on next tick.
      setTimeout(() => {
        void loadSession(session);
      }, 0);
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      loadSession(session);
    });

    const timeout = setTimeout(() => {
      if (mounted) {
        setState((prev) => prev.loading ? { ...prev, loading: false } : prev);
      }
    }, 5000);

    return () => {
      mounted = false;
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, [readCachedProfile, resolveProfileRobust, writeCachedProfile]);

  const signUp = async (email: string, password: string, displayName: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: displayName },
      },
    });
    if (error) throw error;
    return data;
  };

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;

    // Immediately update state so UI transitions without waiting for onAuthStateChange.
    if (data.session?.user) {
      const user = data.session.user;
      loadedUserId.current = user.id;
      loadedProfileUserId.current = null;
      setState({ user, profile: null, session: data.session, loading: false, profileError: null });

      readCachedProfile(user.id).then((cachedProfile) => {
        if (!cachedProfile) return;
        setState((prev) => {
          if (prev.user?.id !== user.id) return prev;
          if (prev.profile) return prev;
          return { ...prev, profile: cachedProfile, profileError: null };
        });
      }).catch(() => {});

      resolveProfileRobust(user).then(({ profile, timedOut }) => {
        if (profile) {
          loadedProfileUserId.current = user.id;
          void writeCachedProfile(profile);
          setState((prev) => ({ ...prev, profile, profileError: null }));
        } else {
          setState((prev) => ({
            ...prev,
            profile: null,
            profileError: timedOut
              ? 'Profile sync timed out. Check connection and retry.'
              : 'Could not load your profile from the database.',
          }));
        }
      }).catch(() => {
        setState((prev) => ({
          ...prev,
          profileError: 'Could not load your profile from the database.',
        }));
      });
    }
    return data;
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    loadedUserId.current = null;
    loadedProfileUserId.current = null;
    setState({ user: null, profile: null, session: null, loading: false, profileError: null });
  };

  const updateUsername = async (username: string) => {
    if (!state.user) throw new Error('Not authenticated');
    const { error } = await supabase
      .from('profiles')
      .update({ username: username.toLowerCase() })
      .eq('id', state.user.id);
    if (error) throw error;
    loadedProfileUserId.current = null;
    const profile = await fetchProfile(supabase, state.user.id);
    if (profile) loadedProfileUserId.current = state.user.id;
    if (profile) void writeCachedProfile(profile);
    setState((prev) => ({
      ...prev,
      profile,
      profileError: profile ? null : 'Could not refresh your profile.',
    }));
  };

  const refreshProfile = useCallback(async () => {
    if (!state.user) return;
    const user = state.user;
    loadedProfileUserId.current = null;
    setState((prev) => ({ ...prev, profileError: null }));
    const { profile, timedOut } = await resolveProfileRobust(user);
    if (profile) {
      loadedProfileUserId.current = user.id;
      void writeCachedProfile(profile);
      setState((prev) => ({ ...prev, profile, profileError: null }));
    } else {
      setState((prev) => ({
        ...prev,
        profile: null,
        profileError: timedOut
          ? 'Profile sync timed out. Check connection and retry.'
          : 'Could not load your profile from the database.',
      }));
    }
  }, [resolveProfileRobust, state.user, writeCachedProfile]);

  return {
    ...state,
    signUp,
    signIn,
    signOut,
    updateUsername,
    refreshProfile,
  };
}
