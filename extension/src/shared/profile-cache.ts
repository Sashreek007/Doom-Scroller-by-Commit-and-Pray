import type { Profile } from './types';

export const PROFILE_CACHE_KEY_PREFIX = 'cached_profile_';
export const AUTH_PROFILE_CACHE_PREFIX = 'cached_auth_profile_';

const MAX_AVATAR_DATA_URL_LENGTH_IN_CACHE = 320_000;
const MAX_TOTAL_AVATAR_CACHE_CHARS = 1_600_000;

function isAvatarDataUrl(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.startsWith('data:image/');
}

function avatarLength(profile: Profile): number {
  return isAvatarDataUrl(profile.avatar_url) ? profile.avatar_url.length : 0;
}

export function sanitizeProfileForCache(profile: Profile): Profile {
  if (!isAvatarDataUrl(profile.avatar_url)) return profile;
  if (profile.avatar_url.length <= MAX_AVATAR_DATA_URL_LENGTH_IN_CACHE) return profile;
  return { ...profile, avatar_url: null };
}

interface WriteProfileCacheOptions {
  includeProfileCache?: boolean;
  includeAuthCache?: boolean;
  preferredUserId?: string;
}

export async function writeProfileToCache(
  profile: Profile,
  options: WriteProfileCacheOptions = {},
): Promise<void> {
  const includeProfileCache = options.includeProfileCache ?? true;
  const includeAuthCache = options.includeAuthCache ?? true;
  const safeProfile = sanitizeProfileForCache(profile);

  const payload: Record<string, Profile> = {};
  if (includeProfileCache) {
    payload[`${PROFILE_CACHE_KEY_PREFIX}${profile.id}`] = safeProfile;
  }
  if (includeAuthCache) {
    payload[`${AUTH_PROFILE_CACHE_PREFIX}${profile.id}`] = safeProfile;
  }

  if (Object.keys(payload).length > 0) {
    await chrome.storage.local.set(payload);
  }

  await enforceAvatarCacheBudget(options.preferredUserId ?? safeProfile.id);
}

export async function enforceAvatarCacheBudget(preferredUserId?: string): Promise<void> {
  try {
    const storage = await chrome.storage.local.get(null);
    type Candidate = {
      key: string;
      profile: Profile;
      avatarLen: number;
      priority: number;
    };

    const candidates: Candidate[] = [];
    let totalAvatarChars = 0;

    for (const [key, raw] of Object.entries(storage)) {
      if (!key.startsWith(PROFILE_CACHE_KEY_PREFIX) && !key.startsWith(AUTH_PROFILE_CACHE_PREFIX)) {
        continue;
      }
      if (!raw || typeof raw !== 'object') continue;

      const profile = raw as Profile;
      const len = avatarLength(profile);
      if (len <= 0) continue;

      totalAvatarChars += len;
      const isAuthKey = key.startsWith(AUTH_PROFILE_CACHE_PREFIX);
      const isPreferredUser = preferredUserId !== undefined && profile.id === preferredUserId;
      const priority = (isPreferredUser ? 2 : 0) + (isAuthKey ? 1 : 0);

      candidates.push({ key, profile, avatarLen: len, priority });
    }

    if (totalAvatarChars <= MAX_TOTAL_AVATAR_CACHE_CHARS) return;

    // Drop least important avatars first; remove bigger ones first for faster convergence.
    candidates.sort((left, right) => (
      left.priority - right.priority || right.avatarLen - left.avatarLen
    ));

    const updates: Record<string, Profile> = {};
    for (const candidate of candidates) {
      if (totalAvatarChars <= MAX_TOTAL_AVATAR_CACHE_CHARS) break;
      if (!isAvatarDataUrl(candidate.profile.avatar_url)) continue;

      updates[candidate.key] = {
        ...candidate.profile,
        avatar_url: null,
      };
      totalAvatarChars -= candidate.avatarLen;
    }

    if (Object.keys(updates).length > 0) {
      await chrome.storage.local.set(updates);
    }
  } catch {
    // Ignore cache cleanup errors; source of truth remains in DB.
  }
}
