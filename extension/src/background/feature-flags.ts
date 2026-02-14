import {
  DEFAULT_FEATURE_FLAGS,
  FEATURE_FLAGS_STORAGE_KEY,
  normalizeFeatureFlags,
  type FeatureFlags,
} from '../shared/feature-flags';

let currentFlags: FeatureFlags = { ...DEFAULT_FEATURE_FLAGS };
let initialized = false;

function handleStorageChange(
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: string,
) {
  if (areaName !== 'local') return;
  const change = changes[FEATURE_FLAGS_STORAGE_KEY];
  if (!change) return;
  currentFlags = normalizeFeatureFlags(change.newValue);
}

export async function initBackgroundFeatureFlags(): Promise<void> {
  if (initialized) return;
  initialized = true;
  const result = await chrome.storage.local.get(FEATURE_FLAGS_STORAGE_KEY);
  currentFlags = normalizeFeatureFlags(result[FEATURE_FLAGS_STORAGE_KEY]);
  chrome.storage.onChanged.addListener(handleStorageChange);
}

export function getBackgroundFeatureFlags(): FeatureFlags {
  return currentFlags;
}
