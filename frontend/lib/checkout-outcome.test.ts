import { describe, expect, it } from "vitest";

import { interpretCheckoutResponse, payBlocker, type PayState } from "./checkout-outcome";
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
  });
});
