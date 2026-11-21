// The bag as the browser holds it: product ids and quantities, nothing else.
// Every price, total and stock decision comes from POST /cart/quote. These pure
// functions only keep the saved lines well-formed and inside the input bounds the
// server enforces again (1–100 per line, at most 50 lines).

import type { CartQuote } from "./types";

/** The keys match the API's QuoteItem and CheckoutItem, so there is no mapping layer. */
export type CartLine = { product_id: number; quantity: number };

export const CART_STORAGE_KEY = "commercelab.cart.v1";
export const MAX_QUANTITY = 100;
export const MAX_LINES = 50;

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function cap(quantity: number): number {
  return Math.min(quantity, MAX_QUANTITY);
}

/**
 * Reads a saved cart. Never throws: whatever is in storage, the shop still loads.
 * - Invalid JSON, or anything but an array, gives [].
 * - Entries without a positive integer product_id and quantity are dropped.
 * - Repeated ids are merged (in first-seen order), quantities capped at MAX_QUANTITY,
 *   and only the first MAX_LINES lines are kept.
 */
export function parseCart(raw: string | null): CartLine[] {
  if (raw === null) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];

  const merged = new Map<number, number>();
  for (const entry of data) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
    const { product_id, quantity } = entry as Record<string, unknown>;
    if (!isPositiveInteger(product_id) || !isPositiveInteger(quantity)) continue;
    merged.set(product_id, cap((merged.get(product_id) ?? 0) + quantity));
  }

  return Array.from(merged, ([product_id, quantity]) => ({ product_id, quantity })).slice(
    0,
    MAX_LINES,
  );
}

/**
 * Adds qty of a product: increases its line if it is already in the bag, otherwise
 * appends a new line at the end. Capped at MAX_QUANTITY. Adding a new line to a bag
 * that already has MAX_LINES lines, or a quantity that isn't a positive integer,
 * changes nothing.
 */
export function addLine(lines: CartLine[], product_id: number, qty = 1): CartLine[] {
  if (!isPositiveInteger(qty)) return lines;
  if (lines.some((line) => line.product_id === product_id)) {
    return lines.map((line) =>
      line.product_id === product_id ? { product_id, quantity: cap(line.quantity + qty) } : line,
    );
  }
  if (lines.length >= MAX_LINES) return lines;
  return [...lines, { product_id, quantity: cap(qty) }];
}

/**
 * Sets a line's quantity, keeping its position. 0 (or less) removes the line; more
 * than MAX_QUANTITY is capped; fractions are rounded down. An id that isn't in the
 * bag changes nothing.
 */
export function setQuantity(lines: CartLine[], product_id: number, qty: number): CartLine[] {
  if (Number.isNaN(qty)) return lines;
  const quantity = Math.floor(qty);
  if (quantity <= 0) return removeLine(lines, product_id);
  return lines.map((line) =>
    line.product_id === product_id ? { product_id, quantity: cap(quantity) } : line,
  );
}

export function removeLine(lines: CartLine[], product_id: number): CartLine[] {
  return lines.filter((line) => line.product_id !== product_id);
}

/**
 * Brings the saved lines in line with a quote:
 * - ids in quote.removed (unknown or no longer sold) are dropped;
 * - a `limited` line the server can still sell some of is set to the quoted quantity,
 *   and the change is reported in `adjusted`;
 * - a sold-out line (quoted quantity 0) is left as it is, so the bag can say so.
 */
export function applyQuote(
  lines: CartLine[],
  quote: CartQuote,
): { lines: CartLine[]; adjusted: { product_id: number; from: number; to: number }[] } {
  const removed = new Set(quote.removed);
  const limitedTo = new Map<number, number>();
  for (const line of quote.lines) {
    if (line.limited && line.quantity > 0) limitedTo.set(line.product.id, line.quantity);
  }

  const adjusted: { product_id: number; from: number; to: number }[] = [];
  const next: CartLine[] = [];
  for (const line of lines) {
    if (removed.has(line.product_id)) continue;
    const to = limitedTo.get(line.product_id);
    if (to !== undefined && to !== line.quantity) {
      adjusted.push({ product_id: line.product_id, from: line.quantity, to });
      next.push({ product_id: line.product_id, quantity: to });
    } else {
      next.push(line);
    }
  }
  return { lines: next, adjusted };
}

export function toQuoteRequest(lines: CartLine[]): { items: CartLine[] } {
  return { items: lines.map(({ product_id, quantity }) => ({ product_id, quantity })) };
}
