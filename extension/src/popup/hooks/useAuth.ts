import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/shared/supabase';
import type { User, Session } from '@supabase/supabase-js';
import type { Profile } from '@/shared/types';

interface AuthState {
  user: User | null;
  profile: Profile | null;
  session: Session | null;
  loading: boolean;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    profile: null,
    session: null,
    loading: true,
  });
  const loadedUserId = useRef<string | null>(null);

  const fetchProfile = useCallback(async (userId: string): Promise<Profile | null> => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();
    if (error) console.warn('[DoomScroller] fetchProfile error:', error.message);
    return data as Profile | null;
  }, []);

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

  useEffect(() => {
    let mounted = true;

    async function loadSession(session: Session | null) {
      if (!mounted) return;
      if (session?.user) {
        if (loadedUserId.current === session.user.id) {
          setState((prev) => ({ ...prev, session, loading: false }));
          return;
        }
        // Show UI immediately with user, fetch profile in background
        loadedUserId.current = session.user.id;
        setState((prev) => ({ ...prev, user: session.user, session, loading: false }));
        const profile = await fetchProfile(session.user.id).catch(() => null);
        const publicProfile = await ensureProfilePublic(profile).catch(() => profile);
        if (mounted) setState((prev) => ({ ...prev, profile: publicProfile }));
      } else {
        loadedUserId.current = null;
        setState({ user: null, profile: null, session: null, loading: false });
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
  }, [ensureProfilePublic, fetchProfile]);

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
    // Immediately update state so UI transitions without waiting for onAuthStateChange
    if (data.session?.user) {
      loadedUserId.current = data.session.user.id;
      setState({ user: data.session.user, profile: null, session: data.session, loading: false });
      // Fetch profile in background
      fetchProfile(data.session.user.id).then((profile) => {
        ensureProfilePublic(profile).then((publicProfile) => {
          setState((prev) => ({ ...prev, profile: publicProfile }));
        }).catch(() => {
          setState((prev) => ({ ...prev, profile }));
        });
      }).catch(() => {});
    }
    return data;
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  };

  const updateUsername = async (username: string) => {
    if (!state.user) throw new Error('Not authenticated');
    const { error } = await supabase
      .from('profiles')
      .update({ username: username.toLowerCase() })
      .eq('id', state.user.id);
    if (error) throw error;
    loadedUserId.current = null;
    const profile = await fetchProfile(state.user.id);
    setState((prev) => ({ ...prev, profile }));
  };

  return {
    ...state,
    signUp,
    signIn,
    signOut,
    updateUsername,
  };
}
