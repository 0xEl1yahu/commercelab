import { describe, expect, test } from "vitest";

import {
  CART_STORAGE_KEY,
  MAX_LINES,
  MAX_QUANTITY,
  addLine,
  applyQuote,
  parseCart,
  removeLine,
  setQuantity,
  toQuoteRequest,
  type CartLine,
} from "./cart";
import type { CartLineQuote, CartQuote, ProductCard } from "./types";

function card(id: number): ProductCard {
  return {
    id,
    slug: `product-${id}`,
    sku: `SKU-${id}`,
    name: `Product ${id}`,
    brand: "Halden",
    category: "keyboards",
    price: "10.00",
    stock_status: "in_stock",
    stock_left: null,
    image: null,
  };
}

function quoteLine(id: number, requested: number, quantity: number): CartLineQuote {
  return {
    product: card(id),
    requested,
    quantity,
    limited: quantity < requested,
    line_total: "0.00",
  };
}

function quote(lines: CartLineQuote[], removed: number[] = []): CartQuote {
  return {
    lines,
    removed,
    subtotal: "0.00",
    delivery: "0.00",
    total: "0.00",
    vat_included: "0.00",
  };
}

describe("constants", () => {
  test("match the frozen contract", () => {
    expect(CART_STORAGE_KEY).toBe("commercelab.cart.v1");
    expect(MAX_QUANTITY).toBe(100);
    expect(MAX_LINES).toBe(50);
  });
});

describe("parseCart", () => {
  test("corrupt JSON gives an empty cart", () => {
    expect(parseCart("{not json")).toEqual([]);
    expect(parseCart("")).toEqual([]);
    expect(parseCart(null)).toEqual([]);
  });

  test("wrong shape gives an empty cart", () => {
    expect(parseCart('{"items": [{"product_id": 1, "quantity": 1}]}')).toEqual([]);
    expect(parseCart('"a string"')).toEqual([]);
    expect(parseCart("42")).toEqual([]);
    expect(parseCart("null")).toEqual([]);
    expect(parseCart('[1, "two", null, [3], {"id": 4, "qty": 1}]')).toEqual([]);
  });

  test("drops non-positive and non-integer quantities", () => {
    const raw = JSON.stringify([
      { product_id: 1, quantity: 0 },
      { product_id: 2, quantity: -3 },
      { product_id: 3, quantity: 1.5 },
      { product_id: 4, quantity: "2" },
      { product_id: 5, quantity: null },
      { product_id: 6, quantity: 2 },
      { product_id: 0, quantity: 1 },
      { product_id: 7.5, quantity: 1 },
      { product_id: "8", quantity: 1 },
    ]);
    expect(parseCart(raw)).toEqual([{ product_id: 6, quantity: 2 }]);
  });

  test("caps quantity at 100", () => {
    const raw = JSON.stringify([{ product_id: 1, quantity: 9999 }]);
    expect(parseCart(raw)).toEqual([{ product_id: 1, quantity: 100 }]);
  });

  test("keeps at most 50 lines", () => {
    const lines = Array.from({ length: 80 }, (_, i) => ({ product_id: i + 1, quantity: 1 }));
    const parsed = parseCart(JSON.stringify(lines));
    expect(parsed).toHaveLength(50);
    expect(parsed[0]).toEqual({ product_id: 1, quantity: 1 });
    expect(parsed[49]).toEqual({ product_id: 50, quantity: 1 });
  });

  test("merges repeated ids", () => {
    const raw = JSON.stringify([
      { product_id: 1, quantity: 2 },
      { product_id: 2, quantity: 1 },
      { product_id: 1, quantity: 3 },
      { product_id: 2, quantity: 99 },
    ]);
    expect(parseCart(raw)).toEqual([
      { product_id: 1, quantity: 5 },
      { product_id: 2, quantity: 100 },
    ]);
  });

  test("ignores extra keys and returns only the two API keys", () => {
    const raw = JSON.stringify([{ product_id: 1, quantity: 2, name: "x" }]);
    expect(parseCart(raw)).toEqual([{ product_id: 1, quantity: 2 }]);
  });
});

describe("addLine", () => {
  test("addLine appends at the end", () => {
    const lines: CartLine[] = [{ product_id: 1, quantity: 1 }];
    expect(addLine(lines, 2)).toEqual([
      { product_id: 1, quantity: 1 },
      { product_id: 2, quantity: 1 },
    ]);
    expect(addLine(lines, 3, 4)).toEqual([
      { product_id: 1, quantity: 1 },
      { product_id: 3, quantity: 4 },
    ]);
    expect(lines).toEqual([{ product_id: 1, quantity: 1 }]);
  });

  test("increases an existing line in place, capped at 100", () => {
    const lines: CartLine[] = [
      { product_id: 1, quantity: 98 },
      { product_id: 2, quantity: 1 },
    ];
    expect(addLine(lines, 1, 5)).toEqual([
      { product_id: 1, quantity: 100 },
      { product_id: 2, quantity: 1 },
    ]);
    expect(addLine([], 1, 500)).toEqual([{ product_id: 1, quantity: 100 }]);
  });

  test("is a no-op when adding a 51st line", () => {
    const lines = Array.from({ length: 50 }, (_, i) => ({ product_id: i + 1, quantity: 1 }));
    expect(addLine(lines, 999)).toEqual(lines);
    expect(addLine(lines, 1)[0]).toEqual({ product_id: 1, quantity: 2 });
  });

  test("ignores a non-positive or non-integer quantity", () => {
    const lines: CartLine[] = [{ product_id: 1, quantity: 1 }];
    expect(addLine(lines, 2, 0)).toEqual(lines);
    expect(addLine(lines, 2, 1.5)).toEqual(lines);
  });
});

describe("setQuantity and removeLine", () => {
  test("setQuantity 0 removes", () => {
    const lines: CartLine[] = [
      { product_id: 1, quantity: 3 },
      { product_id: 2, quantity: 1 },
    ];
    expect(setQuantity(lines, 1, 0)).toEqual([{ product_id: 2, quantity: 1 }]);
  });

  test("setQuantity caps at 100 and keeps the position", () => {
    const lines: CartLine[] = [
      { product_id: 1, quantity: 3 },
      { product_id: 2, quantity: 1 },
    ];
    expect(setQuantity(lines, 1, 250)).toEqual([
      { product_id: 1, quantity: 100 },
      { product_id: 2, quantity: 1 },
    ]);
    expect(setQuantity(lines, 2, 4)).toEqual([
      { product_id: 1, quantity: 3 },
      { product_id: 2, quantity: 4 },
    ]);
  });

  test("setQuantity on an unknown id changes nothing", () => {
    const lines: CartLine[] = [{ product_id: 1, quantity: 3 }];
    expect(setQuantity(lines, 9, 2)).toEqual(lines);
  });

  test("removeLine removes only that id", () => {
    const lines: CartLine[] = [
      { product_id: 1, quantity: 3 },
      { product_id: 2, quantity: 1 },
    ];
    expect(removeLine(lines, 1)).toEqual([{ product_id: 2, quantity: 1 }]);
    expect(removeLine(lines, 9)).toEqual(lines);
  });
});

describe("applyQuote", () => {
  test("applyQuote drops removed ids, clamps limited lines and reports adjustments", () => {
    const lines: CartLine[] = [
      { product_id: 1, quantity: 1 },
      { product_id: 2, quantity: 3 },
      { product_id: 999999, quantity: 1 },
      { product_id: 4, quantity: 2 },
    ];
    const result = applyQuote(
      lines,
      quote([quoteLine(1, 1, 1), quoteLine(2, 3, 2), quoteLine(4, 2, 2)], [999999]),
    );
    expect(result.lines).toEqual([
      { product_id: 1, quantity: 1 },
      { product_id: 2, quantity: 2 },
      { product_id: 4, quantity: 2 },
    ]);
    expect(result.adjusted).toEqual([{ product_id: 2, from: 3, to: 2 }]);
  });

  test("applyQuote leaves sold-out lines in place", () => {
    const lines: CartLine[] = [
      { product_id: 1, quantity: 2 },
      { product_id: 2, quantity: 1 },
    ];
    const result = applyQuote(lines, quote([quoteLine(1, 2, 0), quoteLine(2, 1, 1)]));
    expect(result.lines).toEqual(lines);
    expect(result.adjusted).toEqual([]);
  });
});

describe("toQuoteRequest", () => {
  test("wraps the lines as items with the API's keys", () => {
    const lines: CartLine[] = [{ product_id: 1, quantity: 2 }];
    expect(toQuoteRequest(lines)).toEqual({ items: [{ product_id: 1, quantity: 2 }] });
  });
});
