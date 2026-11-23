import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { interpretCheckoutResponse, type Outcome } from "./checkout-outcome";
import { RECHECK_DELAYS_MS, recheckUntilKnown } from "./checkout-recheck";

const AWAITING: Outcome = { kind: "awaiting", token: "tok", reference: "CL-01501" };

function cancelledOrder() {
  return {
    reference: "CL-01501",
    token: "tok",
    status: "cancelled",
    payment_status: "failed",
    created_at: "2026-11-22T12:00:00Z",
    customer_name: "Sam Okafor",
    items: [],
    subtotal: "1.00",
    delivery: "0.00",
    total: "1.00",
    vat_included: "0.17",
    address: null,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("recheckUntilKnown", () => {
  it("waits 2 s, 4 s and 8 s between re-sends", () => {
    expect(RECHECK_DELAYS_MS).toEqual([2000, 4000, 8000]);
  });

  it("rechecks exhausted → Check again now", async () => {
    const send = vi.fn(async (): Promise<Outcome> => AWAITING);
    const run = recheckUntilKnown({ send, active: () => true });

    await vi.advanceTimersByTimeAsync(1999);
    expect(send).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4000);
    expect(send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(8000);
    expect(send).toHaveBeenCalledTimes(3);

    await expect(run).resolves.toEqual({ status: "exhausted" });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(send).toHaveBeenCalledTimes(3); // then only the shopper's "Check again now"
  });

  it("awaiting → declined on recheck", async () => {
    const answers: Outcome[] = [AWAITING, interpretCheckoutResponse(200, cancelledOrder())];
    const send = vi.fn(async (): Promise<Outcome> => answers.shift()!);
    const run = recheckUntilKnown({ send, active: () => true });

    await vi.advanceTimersByTimeAsync(2000 + 4000);
    await expect(run).resolves.toEqual({ status: "resolved", outcome: { kind: "declined" } });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("a network failure while waiting keeps waiting", async () => {
    const answers: Outcome[] = [{ kind: "retryable" }, { kind: "paid", token: "tok" }];
    const send = vi.fn(async (): Promise<Outcome> => answers.shift()!);
    const run = recheckUntilKnown({ send, active: () => true });

    await vi.advanceTimersByTimeAsync(6000);
    await expect(run).resolves.toEqual({ status: "resolved", outcome: { kind: "paid", token: "tok" } });
  });

  it("stops without sending once it is no longer active (the page left, or a newer run began)", async () => {
    let active = true;
    const send = vi.fn(async (): Promise<Outcome> => AWAITING);
    const run = recheckUntilKnown({ send, active: () => active });

    await vi.advanceTimersByTimeAsync(2000);
    active = false;
    await vi.advanceTimersByTimeAsync(20_000);
    await expect(run).resolves.toEqual({ status: "stopped" });
    expect(send).toHaveBeenCalledTimes(1);
  });
});
