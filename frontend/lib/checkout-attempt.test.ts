import { describe, expect, it } from "vitest";

import {
  ATTEMPT_STORAGE_KEY,
  attemptKey,
  clearAttempt,
  fingerprint,
  markDeclined,
  markSettled,
  markUncertain,
  memoryStorage,
  uncertainAttempt,
  type AttemptStorage,
} from "./checkout-attempt";

const BODY = {
  contact: { email: "sam@northfold.co.uk", name: "Sam Okafor", phone: "07700 900412" },
  address: { line1: "14 Albion Street", city: "Leeds", postcode: "LS1 6HX", country: "GB" },
  items: [{ product_id: 7, quantity: 2 }],
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("fingerprint", () => {
  it("is the same whatever order the keys were written in", () => {
    const reordered = {
      items: [{ quantity: 2, product_id: 7 }],
      address: { country: "GB", postcode: "LS1 6HX", city: "Leeds", line1: "14 Albion Street" },
      contact: { phone: "07700 900412", name: "Sam Okafor", email: "sam@northfold.co.uk" },
    };
    expect(fingerprint(reordered)).toBe(fingerprint(BODY));
  });

  it("changes when any value changes, and keeps array order", () => {
    expect(fingerprint({ ...BODY, items: [{ product_id: 7, quantity: 1 }] })).not.toBe(fingerprint(BODY));
    expect(fingerprint({ a: [1, 2] })).not.toBe(fingerprint({ a: [2, 1] }));
  });
});

describe("attemptKey", () => {
  it("same fingerprint reuses the key", () => {
    const storage = memoryStorage();
    const first = attemptKey(storage, fingerprint(BODY));
    expect(first).toMatch(UUID);
    // A double click, a retry, or a reload: the same bag and details in the same tab.
    expect(attemptKey(storage, fingerprint(BODY))).toBe(first);
    expect(attemptKey(storage, fingerprint(structuredClone(BODY)))).toBe(first);
  });

  it("survives a reload: the key is read back from storage", () => {
    const backing = new Map<string, string>();
    const tab = (): AttemptStorage => ({
      getItem: (k) => backing.get(k) ?? null,
      setItem: (k, v) => void backing.set(k, v),
      removeItem: (k) => void backing.delete(k),
    });
    const first = attemptKey(tab(), fingerprint(BODY));
    expect(backing.has(ATTEMPT_STORAGE_KEY)).toBe(true);
    expect(attemptKey(tab(), fingerprint(BODY))).toBe(first);
  });

  it("different fingerprint gets a new key", () => {
    const storage = memoryStorage();
    const first = attemptKey(storage, fingerprint(BODY));
    const changed = fingerprint({ ...BODY, items: [{ product_id: 7, quantity: 1 }] });
    const second = attemptKey(storage, changed);
    expect(second).toMatch(UUID);
    expect(second).not.toBe(first);
    // The new attempt is now the stored one.
    expect(attemptKey(storage, changed)).toBe(second);
  });

  it("declined gets a new key", () => {
    const storage = memoryStorage();
    const fp = fingerprint(BODY);
    const first = attemptKey(storage, fp);
    markDeclined(storage);
    const second = attemptKey(storage, fp);
    expect(second).toMatch(UUID);
    expect(second).not.toBe(first);
    // The new key is a fresh, undeclined attempt: retrying it reuses it.
    expect(attemptKey(storage, fp)).toBe(second);
  });

  it("clearAttempt forgets the key", () => {
    const storage = memoryStorage();
    const fp = fingerprint(BODY);
    const first = attemptKey(storage, fp);
    clearAttempt(storage);
    expect(storage.getItem(ATTEMPT_STORAGE_KEY)).toBeNull();
    expect(attemptKey(storage, fp)).not.toBe(first);
  });

  it("a corrupt stored attempt is replaced, never trusted", () => {
    for (const raw of ["not json", "[]", '{"fingerprint":1}', '{"key":"","fingerprint":"x"}']) {
      const storage = memoryStorage();
      storage.setItem(ATTEMPT_STORAGE_KEY, raw);
      expect(attemptKey(storage, fingerprint(BODY))).toMatch(UUID);
    }
  });

  it("still returns a key when storage throws", () => {
    const broken: AttemptStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(attemptKey(broken, fingerprint(BODY))).toMatch(UUID);
    expect(() => markDeclined(broken)).not.toThrow();
    expect(() => clearAttempt(broken)).not.toThrow();
    expect(() => markUncertain(broken, {})).not.toThrow();
    expect(() => markSettled(broken)).not.toThrow();
    expect(uncertainAttempt(broken)).toBeNull();
  });
});

describe("uncertain attempts", () => {
  it("an uncertain attempt gives back its key and the exact body it sent", () => {
    const storage = memoryStorage();
    const key = attemptKey(storage, fingerprint(BODY));
    expect(uncertainAttempt(storage)).toBeNull();

    markUncertain(storage, {});
    expect(uncertainAttempt(storage)).toEqual({ key, body: BODY });
    // Re-sending that body after a reload gives the same fingerprint, so the same key.
    expect(attemptKey(storage, fingerprint(uncertainAttempt(storage)!.body))).toBe(key);
  });

  it("remembers the pending order's token and reference, and keeps them on a later retryable", () => {
    const storage = memoryStorage();
    const key = attemptKey(storage, fingerprint(BODY));
    markUncertain(storage, { token: "tok_abc", reference: "CL-01501" });
    markUncertain(storage, {});
    expect(uncertainAttempt(storage)).toEqual({ key, body: BODY, token: "tok_abc", reference: "CL-01501" });
  });

  it("survives a reload: it is read back from the tab's storage", () => {
    const backing = new Map<string, string>();
    const tab = (): AttemptStorage => ({
      getItem: (k) => backing.get(k) ?? null,
      setItem: (k, v) => void backing.set(k, v),
      removeItem: (k) => void backing.delete(k),
    });
    const key = attemptKey(tab(), fingerprint(BODY));
    markUncertain(tab(), { token: "tok_abc" });
    expect(uncertainAttempt(tab())).toMatchObject({ key, body: BODY, token: "tok_abc" });
  });

  it("is resolved by a known outcome", () => {
    // declined
    let storage = memoryStorage();
    attemptKey(storage, fingerprint(BODY));
    markUncertain(storage, {});
    markDeclined(storage);
    expect(uncertainAttempt(storage)).toBeNull();

    // stock or invalid: nothing was created, the key may be reused for the same body
    storage = memoryStorage();
    const key = attemptKey(storage, fingerprint(BODY));
    markUncertain(storage, {});
    markSettled(storage);
    expect(uncertainAttempt(storage)).toBeNull();
    expect(attemptKey(storage, fingerprint(BODY))).toBe(key);

    // paid or conflict
    storage = memoryStorage();
    attemptKey(storage, fingerprint(BODY));
    markUncertain(storage, {});
    clearAttempt(storage);
    expect(uncertainAttempt(storage)).toBeNull();
  });

  it("does nothing without a stored attempt", () => {
    const storage = memoryStorage();
    markUncertain(storage, { token: "tok" });
    expect(uncertainAttempt(storage)).toBeNull();
  });
});
