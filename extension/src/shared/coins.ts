export const METERS_PER_COIN = 20;

export function metersToCoins(meters: number): number {
  const safeMeters = Number.isFinite(meters) ? Math.max(0, meters) : 0;
  return Math.floor(safeMeters / METERS_PER_COIN);
}
