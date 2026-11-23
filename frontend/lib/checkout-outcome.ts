// What a POST /api/checkout answer means for the page, and whether Pay can be
// pressed. Both only read what the backend and the cart quote say: the order's
// status decides paid, declined or awaiting; nothing is computed here.

import type { CartLine } from "./cart";
import type { CartQuote } from "./types";

export type Outcome =
  | { kind: "paid"; token: string }
  | { kind: "declined" }
  | { kind: "awaiting"; token: string; reference: string }
  | { kind: "stock"; product_id: number; available: number }
  | { kind: "conflict" }
  | { kind: "invalid"; message: string; fields: Record<string, string> }
  | { kind: "retryable" };

const CHECK_FIELDS = "Please check the highlighted fields.";
const CHECK_DETAILS = "Please check your details.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fromOrder(body: unknown): Outcome {
  if (!isRecord(body) || typeof body.token !== "string" || body.token === "") return { kind: "retryable" };
  switch (body.status) {
    case "paid":
    case "fulfilled":
      return { kind: "paid", token: body.token };
    case "cancelled":
      return { kind: "declined" };
    case "pending":
      return {
        kind: "awaiting",
        token: body.token,
        reference: typeof body.reference === "string" ? body.reference : "",
      };
    default:
      // An order we can't read is not proof of payment: ask again with the same key.
      return { kind: "retryable" };
  }
}

function fromValidation(body: unknown): Outcome {
  const detail = isRecord(body) ? body.detail : undefined;
  if (typeof detail === "string") return { kind: "invalid", message: detail, fields: {} };
  if (!Array.isArray(detail)) return { kind: "invalid", message: CHECK_DETAILS, fields: {} };

  const fields: Record<string, string> = {};
  for (const error of detail) {
    if (!isRecord(error) || !Array.isArray(error.loc) || typeof error.msg !== "string") continue;
    const field = error.loc.slice(-2).map(String).join(".");
    if (field && !(field in fields)) fields[field] = error.msg;
  }
  return { kind: "invalid", message: CHECK_FIELDS, fields };
}

/**
 * Turns the checkout answer into an Outcome. `status` 0 means the request never got
 * an answer (a network failure); `body` is the parsed JSON, or null.
 *
 * | Response                                   | Outcome    |
 * |--------------------------------------------|------------|
 * | 200/201, order paid or fulfilled           | paid       |
 * | 200/201, order cancelled                   | declined   |
 * | 200/201, order pending                     | awaiting   |
 * | 409 with product_id                        | stock      |
 * | 409 without                                | conflict   |
 * | 422, detail a string or a list             | invalid    |
 * | anything else (502, 5xx, network)          | retryable  |
 */
export function interpretCheckoutResponse(status: number, body: unknown): Outcome {
  if (status === 200 || status === 201) return fromOrder(body);
  if (status === 409) {
    if (isRecord(body) && typeof body.product_id === "number" && typeof body.available === "number") {
      return { kind: "stock", product_id: body.product_id, available: body.available };
    }
    return { kind: "conflict" };
  }
  if (status === 422) return fromValidation(body);
  return { kind: "retryable" };
}


export type PayState = {
  ready: boolean;
  lines: CartLine[];
  quote: CartQuote | null;
  quoting: boolean;
  quoteFailed: boolean;
  hasSoldOut: boolean;
  submitting: boolean;
  /**
   * An attempt with an unknown outcome is being retried: Pay re-sends that stored
   * request as it is, so the current bag and its quote don't apply.
   */
  locked?: boolean;
  /** Locked, and the quote for the stored request itself hasn't arrived yet. */
  lockedQuoting?: boolean;
};

export type PayBlocker = "loading" | "empty" | "submitting" | "quote-failed" | "quoting" | "sold-out";

/**
 * True when the quote was made for these lines. A line matches when it was asked
 * for at that quantity, or when the quote cut it to that quantity: the provider
 * applies a cut to the bag and keeps the quote that made it (whose `requested` is
 * still the old quantity) rather than asking again.
 */
export function quoteDescribes(lines: CartLine[], quote: CartQuote): boolean {
  if (quote.lines.length !== lines.length) return false;
  const byId = new Map(quote.lines.map((line) => [line.product.id, line]));
  return lines.every((line) => {
    const quoted = byId.get(line.product_id);
    return quoted !== undefined && (quoted.requested === line.quantity || quoted.quantity === line.quantity);
  });
}

/**
 * True when the quote prices exactly these items: every one quoted at exactly its
 * quantity (nothing cut), nothing more, nothing removed. Only then is the quote's
 * total the total of a request with these items.
 */
export function quoteMatchesExactly(items: CartLine[], quote: CartQuote): boolean {
  if (quote.removed.length > 0 || quote.lines.length !== items.length) return false;
  const byId = new Map(quote.lines.map((line) => [line.product.id, line]));
  return items.every((item) => {
    const quoted = byId.get(item.product_id);
    return quoted !== undefined && quoted.requested === item.quantity && quoted.quantity === item.quantity;
  });
}

/**
 * Why Pay can't be pressed right now, or null when it can. Pay is only offered for
 * a total the shopper has seen: the quote must be current and for these very lines.
 * A locked retry re-sends the stored request, so it waits only for that request's
 * own quote (see PayState.locked).
 */
export function payBlocker(state: PayState): PayBlocker | null {
  if (!state.ready) return "loading";
  if (state.locked) {
    if (state.submitting) return "submitting";
    return state.lockedQuoting ? "quoting" : null;
  }
  if (state.lines.length === 0) return "empty";
  if (state.submitting) return "submitting";
  if (state.quoteFailed) return "quote-failed";
  if (state.quoting || state.quote === null || !quoteDescribes(state.lines, state.quote)) return "quoting";
  if (state.hasSoldOut) return "sold-out";
  return null;
}
