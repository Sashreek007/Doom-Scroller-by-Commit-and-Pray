export interface FeatureFlags {
  aiAchievements: boolean;
  chatV2: boolean;
  achievementToast: boolean;
}

export const FEATURE_FLAGS_STORAGE_KEY = 'doomscroller_feature_flags';

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  aiAchievements: true,
  chatV2: true,
  achievementToast: true,
};

export function normalizeFeatureFlags(value: unknown): FeatureFlags {
  const candidate = (value && typeof value === 'object' ? value as Record<string, unknown> : {}) as Record<string, unknown>;
  return {
    aiAchievements: typeof candidate.aiAchievements === 'boolean'
      ? candidate.aiAchievements
      : DEFAULT_FEATURE_FLAGS.aiAchievements,
    chatV2: typeof candidate.chatV2 === 'boolean'
      ? candidate.chatV2
      : DEFAULT_FEATURE_FLAGS.chatV2,
    achievementToast: typeof candidate.achievementToast === 'boolean'
      ? candidate.achievementToast
      : DEFAULT_FEATURE_FLAGS.achievementToast,
  };
}

export async function readFeatureFlags(): Promise<FeatureFlags> {
  const result = await chrome.storage.local.get(FEATURE_FLAGS_STORAGE_KEY);
  return normalizeFeatureFlags(result[FEATURE_FLAGS_STORAGE_KEY]);
}

export async function writeFeatureFlags(flags: Partial<FeatureFlags>): Promise<FeatureFlags> {
  const current = await readFeatureFlags();
  const next = normalizeFeatureFlags({ ...current, ...flags });
  await chrome.storage.local.set({ [FEATURE_FLAGS_STORAGE_KEY]: next });
  return next;
}
