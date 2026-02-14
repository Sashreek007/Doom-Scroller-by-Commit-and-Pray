// Aggregates scroll data from content scripts and batches it for Supabase sync

import type { ScrollBatch } from '../shared/types';

const STORAGE_KEY = 'scrollBatches';

// In-memory batch map (per-site)
let batches: Map<string, ScrollBatch> = new Map();

export function addScrollData(site: string, pixels: number, meters: number) {
  const existing = batches.get(site);
  if (existing) {
    existing.totalPixels += pixels;
    existing.totalMeters += meters;
    existing.lastUpdate = Date.now();
  } else {
    batches.set(site, {
      site,
      totalPixels: pixels,
      totalMeters: meters,
      sessionStart: Date.now(),
      lastUpdate: Date.now(),
    });
  }

  // Persist to chrome.storage.local as write-ahead log
  persistBatches();
}

async function persistBatches() {
  const data = Object.fromEntries(batches);
  await chrome.storage.local.set({ [STORAGE_KEY]: data });
}

export async function loadBatches() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const data = result[STORAGE_KEY];
  if (data && typeof data === 'object') {
    batches = new Map(Object.entries(data));
  }
}

export function getBatches(): Map<string, ScrollBatch> {
  return batches;
}

export function clearBatches() {
  batches.clear();
  chrome.storage.local.remove(STORAGE_KEY);
}

export function restoreBatches(restored: ScrollBatch[]) {
  for (const batch of restored) {
    const existing = batches.get(batch.site);
    if (existing) {
      existing.totalPixels += batch.totalPixels;
      existing.totalMeters += batch.totalMeters;
      existing.sessionStart = Math.min(existing.sessionStart, batch.sessionStart);
      existing.lastUpdate = Math.max(existing.lastUpdate, batch.lastUpdate);
    } else {
      batches.set(batch.site, { ...batch });
    }
  }

  persistBatches();
}

// Get a snapshot and clear for sync
export function drainBatches(): ScrollBatch[] {
  const drained = Array.from(batches.values()).filter(
    (b) => b.totalPixels > 0,
  );
  clearBatches();
  return drained;
}
