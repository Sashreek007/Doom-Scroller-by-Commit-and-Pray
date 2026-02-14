import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/shared/supabase';
import type { User, Session } from '@supabase/supabase-js';
import type { Profile } from '@/shared/types';
import { ensureProfileExists, fetchProfile } from '@/shared/profile';

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
          profileError: null,
        }));

        if (loadedProfileUserId.current === userId) return;

        const profile = await resolveProfile(session.user).catch(() => null);
        if (!mounted) return;
        if (profile) {
          loadedProfileUserId.current = userId;
          setState((prev) => ({ ...prev, profile, profileError: null }));
        } else {
          setState((prev) => ({
            ...prev,
            profile: null,
            profileError: 'Could not load your profile from the database.',
          }));
        }
      } else {
        loadedUserId.current = null;
        loadedProfileUserId.current = null;
        setState({ user: null, profile: null, session: null, loading: false, profileError: null });
      }
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        await loadSession(session);
      },
    );

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
  }, [resolveProfile]);

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

      resolveProfile(user).then((profile) => {
        if (profile) {
          loadedProfileUserId.current = user.id;
          setState((prev) => ({ ...prev, profile, profileError: null }));
        } else {
          setState((prev) => ({
            ...prev,
            profile: null,
            profileError: 'Could not load your profile from the database.',
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
    const profile = await resolveProfile(user).catch(() => null);
    if (profile) {
      loadedProfileUserId.current = user.id;
      setState((prev) => ({ ...prev, profile, profileError: null }));
    } else {
      setState((prev) => ({
        ...prev,
        profile: null,
        profileError: 'Could not load your profile from the database.',
      }));
    }
  }, [resolveProfile, state.user]);

  return {
    ...state,
    signUp,
    signIn,
    signOut,
    updateUsername,
    refreshProfile,
  };
}
