// One Idempotency-Key per checkout attempt, kept in sessionStorage so a double
// click, a retry after a network failure, or a reload of the tab sends the same key
// for the same request, and the backend returns the order it already made instead
// of making (and charging) a second one.
//
// What is stored, for this tab only (sessionStorage, gone when the tab closes): the
// key, and the attempt's fingerprint, which is the full request body as stable JSON
// (contact, delivery address and bag lines). The body never holds card data, so
// neither does storage.
//
// An attempt is identified by that fingerprint:
// - same body, not declined: the stored key is reused;
// - a different body (another bag, other details): a new key, because the backend
//   refuses a key reused for a different request;
// - declined: a new key, because a declined order is cancelled for good.
//
// An attempt whose outcome is unknown (no answer, or the provider hasn't replied) is
// marked uncertain. Until it is resolved, the page re-sends exactly that body with
// that key, even after a reload, because the order may already exist.

export const ATTEMPT_STORAGE_KEY = "commercelab.checkout-attempt.v1";

/** The parts of Storage this module uses (sessionStorage in the browser). */
export type AttemptStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** The pending order, when the backend has named one (an `awaiting` answer). */
export type PendingOrder = { token?: string; reference?: string };

type StoredAttempt = {
  fingerprint: string;
  key: string;
  declined: boolean;
  /** Set while the outcome is unknown. */
  uncertain?: PendingOrder;
};

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

/** The request body as stable JSON: equal bodies give equal strings. */
export function fingerprint(body: unknown): string {
  return JSON.stringify(stable(body));
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function read(storage: AttemptStorage): StoredAttempt | null {
  try {
    const raw = storage.getItem(ATTEMPT_STORAGE_KEY);
    if (raw === null) return null;
    const data: unknown = JSON.parse(raw);
    if (data === null || typeof data !== "object" || Array.isArray(data)) return null;
    const { fingerprint, key, declined, uncertain } = data as Record<string, unknown>;
    if (typeof fingerprint !== "string" || typeof key !== "string" || key === "") return null;
    const attempt: StoredAttempt = { fingerprint, key, declined: declined === true };
    if (uncertain !== null && typeof uncertain === "object" && !Array.isArray(uncertain)) {
      const pending = uncertain as Record<string, unknown>;
      attempt.uncertain = {};
      const token = optionalString(pending.token);
      const reference = optionalString(pending.reference);
      if (token) attempt.uncertain.token = token;
      if (reference) attempt.uncertain.reference = reference;
    }
    return attempt;
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
  if (stored !== null) write(storage, { fingerprint: stored.fingerprint, key: stored.key, declined: true });
}

/**
 * The stored attempt's outcome is unknown: no answer reached the page (retryable),
 * or the order is pending (awaiting, with its token and reference). A later call
 * without a token keeps the one already known.
 */
export function markUncertain(storage: AttemptStorage, pending: PendingOrder): void {
  const stored = read(storage);
  if (stored === null) return;
  const uncertain: PendingOrder = { ...stored.uncertain };
  if (pending.token) uncertain.token = pending.token;
  if (pending.reference) uncertain.reference = pending.reference;
  write(storage, { ...stored, uncertain });
}

/**
 * The stored attempt's outcome is known and no order was made (a stock or validation
 * answer). The key stays: the same body may still use it.
 */
export function markSettled(storage: AttemptStorage): void {
  const stored = read(storage);
  if (stored?.uncertain !== undefined) {
    write(storage, { fingerprint: stored.fingerprint, key: stored.key, declined: stored.declined });
  }
}

/** The attempt whose outcome is still unknown, with the exact body to re-send; null if none. */
export function uncertainAttempt<Body = unknown>(
  storage: AttemptStorage,
): ({ key: string; body: Body } & PendingOrder) | null {
  const stored = read(storage);
  if (stored === null || stored.uncertain === undefined || stored.declined) return null;
  try {
    const body = JSON.parse(stored.fingerprint) as Body;
    return { key: stored.key, body, ...stored.uncertain };
  } catch {
    return null;
  }
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
