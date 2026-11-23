// How high the product page's quantity stepper goes: min(10, stock_left ?? 10).
// A convenience bound only. The quote decides what can really be bought, and the
// bag clamps to it.

export const MAX_PER_ORDER_STEP = 10;

export function purchaseLimit(stockLeft: number | null | undefined): number {
  const limit = Math.min(MAX_PER_ORDER_STEP, stockLeft ?? MAX_PER_ORDER_STEP);
  return Math.max(1, limit);
}
