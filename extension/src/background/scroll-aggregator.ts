// Aggregates scroll data from content scripts and batches it for Supabase sync

import type { ScrollBatch } from '../shared/types';

const STORAGE_KEY = 'scrollBatches';
const INFLIGHT_STORAGE_KEY = 'scrollBatchesInFlight';

// In-memory batch map (per-site)
let batches: Map<string, ScrollBatch> = new Map();
let inFlightBatches: Map<string, ScrollBatch> = new Map();

function cloneBatch(batch: ScrollBatch): ScrollBatch {
  return { ...batch };
}

function mergeBatchesInto(target: Map<string, ScrollBatch>, incoming: Iterable<ScrollBatch>) {
  for (const batch of incoming) {
    const existing = target.get(batch.site);
    if (existing) {
      existing.totalPixels += batch.totalPixels;
      existing.totalMeters += batch.totalMeters;
      existing.sessionStart = Math.min(existing.sessionStart, batch.sessionStart);
      existing.lastUpdate = Math.max(existing.lastUpdate, batch.lastUpdate);
    } else {
      target.set(batch.site, cloneBatch(batch));
    }
  }
}

function mapFromStorage(value: unknown): Map<string, ScrollBatch> {
  if (!value || typeof value !== 'object') return new Map();
  const entries = Object.entries(value as Record<string, ScrollBatch>);
  return new Map(entries.map(([site, batch]) => [site, cloneBatch(batch)]));
}

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
  void persistState();
}

async function persistState() {
  await chrome.storage.local.set({
    [STORAGE_KEY]: Object.fromEntries(batches),
    [INFLIGHT_STORAGE_KEY]: Object.fromEntries(inFlightBatches),
  });
}

export async function loadBatches() {
  const result = await chrome.storage.local.get([STORAGE_KEY, INFLIGHT_STORAGE_KEY]);
  batches = mapFromStorage(result[STORAGE_KEY]);
  inFlightBatches = mapFromStorage(result[INFLIGHT_STORAGE_KEY]);

  // On service-worker restart, in-flight sync outcome is unknown — requeue it.
  if (inFlightBatches.size > 0) {
    mergeBatchesInto(batches, inFlightBatches.values());
    inFlightBatches.clear();
    await persistState();
  }
}

export function getBatches(): Map<string, ScrollBatch> {
  const merged = new Map<string, ScrollBatch>();
  mergeBatchesInto(merged, batches.values());
  mergeBatchesInto(merged, inFlightBatches.values());
  return merged;
}

export function clearBatches() {
  batches.clear();
  inFlightBatches.clear();
  void chrome.storage.local.remove([STORAGE_KEY, INFLIGHT_STORAGE_KEY]);
}

export function restoreBatches(restored: ScrollBatch[]) {
  mergeBatchesInto(batches, restored);

  for (const batch of restored) {
    inFlightBatches.delete(batch.site);
  }

  void persistState();
}

// Get a snapshot and clear for sync
export function drainBatches(): ScrollBatch[] {
  if (inFlightBatches.size > 0) {
    return [];
  }

  const drained = Array.from(batches.values()).filter(
    (b) => b.totalPixels > 0,
  ).map(cloneBatch);
  if (drained.length === 0) return drained;

  inFlightBatches = new Map(drained.map((batch) => [batch.site, cloneBatch(batch)]));
  batches.clear();
  void persistState();

  return drained;
}

export function confirmSyncedBatches(synced: ScrollBatch[]) {
  for (const batch of synced) {
    inFlightBatches.delete(batch.site);
  }
  void persistState();
}
