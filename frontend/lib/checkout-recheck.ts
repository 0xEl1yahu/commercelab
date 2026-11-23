// While a payment is unconfirmed, the page re-sends the same request with the same
// key on a schedule, so the backend can ask the provider again (it never charges
// twice for one key). After the last scheduled re-send the shopper gets
// "Check again now".

import type { Outcome } from "./checkout-outcome";

/** The waits before each automatic re-send: 2 s, then 4 s, then 8 s. */
export const RECHECK_DELAYS_MS = [2000, 4000, 8000] as const;

/** Answers that leave the outcome unknown: keep waiting, same request, same key. */
export function stillUnknown(outcome: Outcome): boolean {
  return outcome.kind === "awaiting" || outcome.kind === "retryable";
}

export type RecheckRun =
  | { status: "resolved"; outcome: Outcome }
  | { status: "exhausted" }
  | { status: "stopped" };

/**
 * Re-sends after each delay until an answer settles the outcome.
 * - `send` re-sends the stored request and returns what it means;
 * - `active` is asked before every send: false (the page left, or a newer run
 *   started) stops the run without sending.
 */
export async function recheckUntilKnown({
  send,
  active,
  delays = RECHECK_DELAYS_MS,
}: {
  send: () => Promise<Outcome>;
  active: () => boolean;
  delays?: readonly number[];
}): Promise<RecheckRun> {
  for (const delay of delays) {
    await new Promise<void>((resolve) => setTimeout(resolve, delay));
    if (!active()) return { status: "stopped" };
    const outcome = await send();
    if (!stillUnknown(outcome)) return { status: "resolved", outcome };
  }
  return { status: "exhausted" };
}
