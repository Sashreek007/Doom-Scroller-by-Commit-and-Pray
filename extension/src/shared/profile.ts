import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { Profile } from './types';

function toUsernameBase(user: User): string {
  const emailLocalPart = user.email?.split('@')[0] ?? user.id.slice(0, 8);
  const normalized = emailLocalPart
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/^_+|_+$/g, '');
  const fallback = normalized.length > 0 ? normalized : `user${user.id.slice(0, 4)}`;
  return fallback.slice(0, 15);
}

function generateUsername(user: User): string {
  const suffix = Math.random().toString(16).slice(2, 6).padEnd(4, '0');
  return `${toUsernameBase(user)}_${suffix}`;
}

function toDisplayName(user: User): string {
  const metaDisplayName = user.user_metadata?.display_name;
  if (typeof metaDisplayName === 'string' && metaDisplayName.trim().length > 0) {
    return metaDisplayName.trim();
  }
  return user.email?.split('@')[0] ?? 'DoomScroller';
}

export async function fetchProfile(
  supabase: SupabaseClient,
  userId: string,
): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (error) {
    console.warn('[DoomScroller] fetchProfile error:', error.message);
    return null;
  }
  return (data as Profile | null) ?? null;
}

export async function ensureProfileExists(
  supabase: SupabaseClient,
  user: User,
): Promise<Profile | null> {
  const existing = await fetchProfile(supabase, user.id);
  if (existing) return existing;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const username = generateUsername(user);
    let { data, error } = await supabase
      .from('profiles')
      .insert({
        id: user.id,
        username,
        display_name: toDisplayName(user),
        is_public: true,
        world_public: true,
        friends_public: true,
      })
      .select('*')
      .single();

    if (error) {
      const msg = error.message?.toLowerCase() ?? '';
      const missingSplitPrivacyColumns = msg.includes('world_public') || msg.includes('friends_public');
      if (missingSplitPrivacyColumns) {
        const legacyInsert = await supabase
          .from('profiles')
          .insert({
            id: user.id,
            username,
            display_name: toDisplayName(user),
            is_public: true,
          })
          .select('*')
          .single();
        data = legacyInsert.data;
        error = legacyInsert.error;
      }
    }

    if (!error && data) {
      return data as Profile;
    }

    const message = error?.message?.toLowerCase() ?? '';
    const isUniqueViolation = error?.code === '23505' || message.includes('duplicate') || message.includes('unique');
    if (isUniqueViolation) {
      continue;
    }

    const fromDb = await fetchProfile(supabase, user.id);
    if (fromDb) return fromDb;

    // RLS/auth errors are not retryable here; the caller can surface a clear user-facing state.
    if (error) {
      console.warn('[DoomScroller] ensureProfileExists error:', error.message);
    }
    break;
  }

  return fetchProfile(supabase, user.id);
}
