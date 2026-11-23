// One Idempotency-Key per checkout attempt, kept in sessionStorage so a double
// click, a retry after a network failure, or a reload of the tab sends the same key
// for the same request, and the backend returns the order it already made instead
// of making (and charging) a second one.
//
// An attempt is identified by the fingerprint of its request body:
// - same body, not declined: the stored key is reused;
// - a different body (another bag, other details): a new key, because the backend
//   refuses a key reused for a different request;
// - declined: a new key, because a declined order is cancelled for good.

export const ATTEMPT_STORAGE_KEY = "commercelab.checkout-attempt.v1";

/** The parts of Storage this module uses (sessionStorage in the browser). */
export type AttemptStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type StoredAttempt = { fingerprint: string; key: string; declined: boolean };

/** JSON with object keys sorted at every level, so key order never changes the result. */
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (item !== undefined) sorted[key] = stable(item);
    }
    return sorted;
  }
  return value;
}

export function fingerprint(body: unknown): string {
  return JSON.stringify(stable(body));
}

function read(storage: AttemptStorage): StoredAttempt | null {
  try {
    const raw = storage.getItem(ATTEMPT_STORAGE_KEY);
    if (raw === null) return null;
    const data: unknown = JSON.parse(raw);
    if (data === null || typeof data !== "object" || Array.isArray(data)) return null;
    const { fingerprint, key, declined } = data as Record<string, unknown>;
    if (typeof fingerprint !== "string" || typeof key !== "string" || key === "") return null;
    return { fingerprint, key, declined: declined === true };
  } catch {
    return null; // unreadable or blocked: start a new attempt
  }
}

function write(storage: AttemptStorage, attempt: StoredAttempt): void {
  try {
    storage.setItem(ATTEMPT_STORAGE_KEY, JSON.stringify(attempt));
  } catch {
    // Blocked storage: the key still holds for this page, just not across a reload.
  }
}

/** The key for a request with this fingerprint: the stored one if it still applies, else a new one. */
export function attemptKey(storage: AttemptStorage, fp: string): string {
  const stored = read(storage);
  if (stored !== null && stored.fingerprint === fp && !stored.declined) return stored.key;
  const key = crypto.randomUUID();
  write(storage, { fingerprint: fp, key, declined: false });
  return key;
}

/** The stored attempt was declined: the next attempt, even with the same body, gets a new key. */
export function markDeclined(storage: AttemptStorage): void {
  const stored = read(storage);
  if (stored !== null) write(storage, { ...stored, declined: true });
}

/** Forgets the attempt (after an order is placed, or when the backend refused the key). */
export function clearAttempt(storage: AttemptStorage): void {
  try {
    storage.removeItem(ATTEMPT_STORAGE_KEY);
  } catch {
    // Nothing to forget.
  }
}

/** An in-memory Storage, for tests and for browsers where sessionStorage is blocked. */
export function memoryStorage(): AttemptStorage {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
}

/**
 * sessionStorage when it works, otherwise an in-memory stand-in (private modes and
 * blocked storage throw on access). Browser only.
 */
export function attemptStorage(): AttemptStorage {
  try {
    const storage = window.sessionStorage;
    const probe = `${ATTEMPT_STORAGE_KEY}.probe`;
    storage.setItem(probe, "1");
    storage.removeItem(probe);
    return storage;
  } catch {
    return memoryStorage();
  }
}
