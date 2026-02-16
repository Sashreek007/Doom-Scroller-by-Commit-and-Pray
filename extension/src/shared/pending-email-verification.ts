const PENDING_EMAIL_VERIFICATION_KEY = 'doom_pending_email_verification';
const PENDING_EMAIL_VERIFICATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface PendingEmailVerificationState {
  email: string;
  createdAt: number;
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function parsePendingState(raw: unknown): PendingEmailVerificationState | null {
  if (!raw || typeof raw !== 'object') return null;

  const value = raw as { email?: unknown; createdAt?: unknown };
  if (typeof value.email !== 'string' || typeof value.createdAt !== 'number') return null;

  const email = normalizeEmail(value.email);
  if (!email || !email.includes('@')) return null;

  if (!Number.isFinite(value.createdAt)) return null;
  if (Date.now() - value.createdAt > PENDING_EMAIL_VERIFICATION_TTL_MS) return null;

  return { email, createdAt: value.createdAt };
}

export async function getPendingEmailVerification(): Promise<PendingEmailVerificationState | null> {
  try {
    const result = await chrome.storage.local.get(PENDING_EMAIL_VERIFICATION_KEY);
    const parsed = parsePendingState(result[PENDING_EMAIL_VERIFICATION_KEY]);
    if (!parsed) {
      await clearPendingEmailVerification();
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function setPendingEmailVerification(email: string): Promise<void> {
  const normalized = normalizeEmail(email);
  if (!normalized) return;

  const payload: PendingEmailVerificationState = {
    email: normalized,
    createdAt: Date.now(),
  };
  await chrome.storage.local.set({ [PENDING_EMAIL_VERIFICATION_KEY]: payload });
}

export async function clearPendingEmailVerification(): Promise<void> {
  await chrome.storage.local.remove(PENDING_EMAIL_VERIFICATION_KEY);
}

