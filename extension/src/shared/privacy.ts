import type { Profile } from './types';

type ProfileLike = Pick<Profile, 'is_public' | 'world_public' | 'friends_public' | 'can_view_details'>;

export function getWorldPublic(profile: ProfileLike | null | undefined): boolean {
  if (!profile) return true;
  if (typeof profile.world_public === 'boolean') return profile.world_public;
  return profile.is_public;
}

export function getFriendsPublic(profile: ProfileLike | null | undefined): boolean {
  if (!profile) return true;
  if (typeof profile.friends_public === 'boolean') return profile.friends_public;
  return true;
}

export function canViewProfileDetails(
  profile: ProfileLike | null | undefined,
  options: { isOwnProfile: boolean; isFriend?: boolean },
): boolean {
  if (!profile) return false;
  if (options.isOwnProfile) return true;
  if (typeof profile.can_view_details === 'boolean') return profile.can_view_details;
  if (getWorldPublic(profile)) return true;
  return getFriendsPublic(profile) && Boolean(options.isFriend);
}

export function getVisibilityLabel(profile: ProfileLike | null | undefined): 'public' | 'friends' | 'private' {
  if (!profile) return 'public';
  if (getWorldPublic(profile)) return 'public';
  if (getFriendsPublic(profile)) return 'friends';
  return 'private';
}

