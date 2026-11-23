import { describe, expect, it } from "vitest";

import { MAX_PER_ORDER_STEP, purchaseLimit } from "./buy-limit";

describe("purchaseLimit", () => {
  it("is 10 when the product has no low-stock count", () => {
    expect(purchaseLimit(null)).toBe(MAX_PER_ORDER_STEP);
    expect(purchaseLimit(undefined)).toBe(MAX_PER_ORDER_STEP);
  });

  it("follows a low-stock count below 10", () => {
    expect(purchaseLimit(2)).toBe(2);
    expect(purchaseLimit(1)).toBe(1);
  });

  it("never goes above 10", () => {
    expect(purchaseLimit(40)).toBe(10);
  });

  it("is at least 1 so the stepper always has a value", () => {
    expect(purchaseLimit(0)).toBe(1);
  });
});
