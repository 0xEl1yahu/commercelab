import { describe, expect, it } from "vitest";

import {
  interpretCheckoutResponse,
  payBlocker,
  quoteMatchesExactly,
  type PayState,
} from "./checkout-outcome";
import type { CartQuote, Order } from "./types";

function order(status: Order["status"]): Order {
  return {
    reference: "CL-01501",
    token: "tok_abc",
    status,
    payment_status: status === "paid" ? "succeeded" : status === "cancelled" ? "failed" : "unknown",
    created_at: "2026-11-22T12:00:00Z",
    customer_name: "Sam Okafor",
    items: [],
    subtotal: "149.00",
    delivery: "0.00",
    total: "149.00",
    vat_included: "24.83",
    address: null,
  };
}

describe("interpretCheckoutResponse", () => {
  it("201 with a paid order is paid", () => {
    expect(interpretCheckoutResponse(201, order("paid"))).toEqual({ kind: "paid", token: "tok_abc" });
  });

  it("200 (a retry) with a fulfilled order is paid", () => {
    expect(interpretCheckoutResponse(200, order("fulfilled"))).toEqual({ kind: "paid", token: "tok_abc" });
  });

  it("a cancelled order is declined", () => {
    expect(interpretCheckoutResponse(201, order("cancelled"))).toEqual({ kind: "declined" });
    expect(interpretCheckoutResponse(200, order("cancelled"))).toEqual({ kind: "declined" });
  });

  it("a pending order is awaiting, with its token and reference", () => {
    expect(interpretCheckoutResponse(201, order("pending"))).toEqual({
      kind: "awaiting",
      token: "tok_abc",
      reference: "CL-01501",
    });
    expect(interpretCheckoutResponse(200, order("pending")).kind).toBe("awaiting");
  });

  it("409 with product_id is a stock problem", () => {
    const body = { detail: "not enough stock", product_id: 12, requested: 2, available: 1 };
    expect(interpretCheckoutResponse(409, body)).toEqual({ kind: "stock", product_id: 12, available: 1 });
    expect(interpretCheckoutResponse(409, { ...body, available: 0 })).toEqual({
      kind: "stock",
      product_id: 12,
      available: 0,
    });
  });

  it("409 without product_id is a conflict", () => {
    expect(interpretCheckoutResponse(409, { detail: "key reused for a different request" })).toEqual({
      kind: "conflict",
    });
  });

  it("422 with a string detail is invalid with that message", () => {
    expect(interpretCheckoutResponse(422, { detail: "product 9 is no longer sold" })).toEqual({
      kind: "invalid",
      message: "product 9 is no longer sold",
      fields: {},
    });
  });

  it("422 with a list maps each loc's last two parts to its msg", () => {
    const body = {
      detail: [
        { loc: ["body", "address", "postcode"], msg: "String should match pattern", type: "string_pattern_mismatch" },
        { loc: ["body", "contact", "email"], msg: "Bad email", type: "x" },
      ],
    };
    expect(interpretCheckoutResponse(422, body)).toEqual({
      kind: "invalid",
      message: "Please check the highlighted fields.",
      fields: { "address.postcode": "String should match pattern", "contact.email": "Bad email" },
    });
  });

  it("anything else, including 502 and a network failure (status 0), is retryable", () => {
    expect(interpretCheckoutResponse(502, { detail: "upstream unavailable" })).toEqual({ kind: "retryable" });
    expect(interpretCheckoutResponse(0, null)).toEqual({ kind: "retryable" });
    expect(interpretCheckoutResponse(500, "Internal Server Error")).toEqual({ kind: "retryable" });
    expect(interpretCheckoutResponse(400, { detail: "request body is not valid JSON" })).toEqual({
      kind: "retryable",
    });
    expect(interpretCheckoutResponse(503, null)).toEqual({ kind: "retryable" });
  });

  it("a malformed success or error body is retryable, never paid", () => {
    expect(interpretCheckoutResponse(201, null)).toEqual({ kind: "retryable" });
    expect(interpretCheckoutResponse(201, { status: "paid" })).toEqual({ kind: "retryable" });
    expect(interpretCheckoutResponse(200, { ...order("paid"), status: "refunded" })).toEqual({
      kind: "retryable",
    });
    expect(interpretCheckoutResponse(409, null)).toEqual({ kind: "conflict" });
    expect(interpretCheckoutResponse(422, { detail: 5 })).toEqual({
      kind: "invalid",
      message: "Please check your details.",
      fields: {},
    });
  });
});

describe("payBlocker", () => {
  const quote = {
    lines: [
      { product: { id: 7 }, requested: 2, quantity: 2, limited: false, line_total: "298.00" },
      { product: { id: 9 }, requested: 1, quantity: 1, limited: false, line_total: "49.00" },
    ],
    removed: [],
    subtotal: "347.00",
    delivery: "0.00",
    total: "347.00",
    vat_included: "57.83",
  } as unknown as CartQuote;
  const lines = [
    { product_id: 7, quantity: 2 },
    { product_id: 9, quantity: 1 },
  ];
  const ok: PayState = {
    ready: true,
    lines,
    quote,
    quoting: false,
    quoteFailed: false,
    hasSoldOut: false,
    submitting: false,
  };

  it("is null when the quote describes the bag and nothing is in flight", () => {
    expect(payBlocker(ok)).toBeNull();
  });

  it("blocks until the bag is read and while it is empty", () => {
    expect(payBlocker({ ...ok, ready: false })).toBe("loading");
    expect(payBlocker({ ...ok, lines: [], quote: null })).toBe("empty");
  });

  it("blocks while a request is in flight", () => {
    expect(payBlocker({ ...ok, submitting: true })).toBe("submitting");
  });

  it("blocks while the quote is missing, on its way, failed or describes other lines", () => {
    expect(payBlocker({ ...ok, quote: null })).toBe("quoting");
    expect(payBlocker({ ...ok, quoting: true })).toBe("quoting");
    expect(payBlocker({ ...ok, quoteFailed: true })).toBe("quote-failed");
    expect(payBlocker({ ...ok, lines: [{ product_id: 7, quantity: 1 }, lines[1]] })).toBe("quoting");
    expect(payBlocker({ ...ok, lines: [lines[0]] })).toBe("quoting");
  });

  it("blocks while a line is sold out", () => {
    expect(payBlocker({ ...ok, hasSoldOut: true })).toBe("sold-out");
  });

  it("while an uncertain attempt is locked, only an in-flight request blocks the re-send", () => {
    // The re-send is the stored request, so today's bag and quote don't matter: the
    // reload's re-quote may have cut the bag because the first order holds the stock.
    const locked = { ...ok, locked: true };
    expect(payBlocker({ ...locked, quoting: true })).toBeNull();
    expect(payBlocker({ ...locked, quoteFailed: true })).toBeNull();
    expect(payBlocker({ ...locked, hasSoldOut: true })).toBeNull();
    expect(payBlocker({ ...locked, lines: [{ product_id: 7, quantity: 1 }, lines[1]] })).toBeNull();
    expect(payBlocker({ ...locked, lines: [], quote: null })).toBeNull();
    expect(payBlocker({ ...locked, submitting: true })).toBe("submitting");
    expect(payBlocker({ ...locked, ready: false })).toBe("loading");
    // ...but Pay waits for the quote of the locked request itself.
    expect(payBlocker({ ...locked, lockedQuoting: true })).toBe("quoting");
    // ...and never pays it without that price: a failed quote blocks too.
    expect(payBlocker({ ...locked, lockedQuoteFailed: true })).toBe("quote-failed");
  });

  it("a bag the quote cut on load can still pay (the provider doesn't re-quote a cut)", () => {
    // Bag 50; only 4 can be sold. The provider sets the line to 4 and keeps this
    // quote, which still says requested 50.
    const cut = {
      ...quote,
      lines: [{ product: { id: 7 }, requested: 50, quantity: 4, limited: true, line_total: "596.00" }],
    } as unknown as CartQuote;
    expect(payBlocker({ ...ok, quote: cut, lines: [{ product_id: 7, quantity: 4 }] })).toBeNull();
    // Still blocked for a bag the quote doesn't describe at all.
    expect(payBlocker({ ...ok, quote: cut, lines: [{ product_id: 7, quantity: 3 }] })).toBe("quoting");
  });
});

describe("quoteMatchesExactly", () => {
  const line = (id: number, requested: number, quantity: number) => ({
    product: { id },
    requested,
    quantity,
    limited: quantity < requested,
    line_total: "1.00",
  });
  const quoteOf = (lines: ReturnType<typeof line>[], removed: number[] = []) =>
    ({ lines, removed, subtotal: "1.00", delivery: "0.00", total: "1.00", vat_included: "0.17" }) as unknown as CartQuote;
  const items = [
    { product_id: 7, quantity: 3 },
    { product_id: 9, quantity: 1 },
  ];

  it("is true only when every item is quoted at exactly its quantity", () => {
    expect(quoteMatchesExactly(items, quoteOf([line(7, 3, 3), line(9, 1, 1)]))).toBe(true);
  });

  it("is false when the quote cut a line, dropped one, added one, or removed an id", () => {
    // The earlier order holds the stock, so today only 1 of the 3 could be sold.
    expect(quoteMatchesExactly(items, quoteOf([line(7, 3, 1), line(9, 1, 1)]))).toBe(false);
    expect(quoteMatchesExactly(items, quoteOf([line(7, 3, 3)]))).toBe(false);
    expect(quoteMatchesExactly(items, quoteOf([line(7, 3, 3), line(9, 1, 1), line(4, 1, 1)]))).toBe(false);
    expect(quoteMatchesExactly(items, quoteOf([line(7, 3, 3), line(9, 1, 1)], [9]))).toBe(false);
    expect(quoteMatchesExactly(items, quoteOf([line(7, 2, 3), line(9, 1, 1)]))).toBe(false);
  });
});
