"use client";

import { ProductImage } from "@/components/product/product-image";
import type { CartNotice } from "@/components/cart/cart-provider";
import type { CartLine } from "@/lib/cart";
import { quoteMatchesExactly } from "@/lib/checkout-outcome";
import { formatGBP } from "@/lib/money";
import type { CartLineQuote, CartQuote, ProductCard } from "@/lib/types";
import { cn } from "@/lib/utils";

/** The checkout's own stock message, after a 409: someone bought units while the shopper paid. */
export type StockWarning = {
  product_id: number;
  name: string;
  /** The quantity that was sent with Pay. */
  from: number;
  /** What the server said it can still sell (0: sold out, and removed from the bag). */
  available: number;
};

type Props = {
  quote: CartQuote | null;
  /** The quote is on its way, or failed: numbers are shown dimmed. */
  stale: boolean;
  notices: Record<number, CartNotice>;
  stockWarning: StockWarning | null;
  /** Whether a sold-out line can be removed right now (not while paying or locked). */
  canRemove: boolean;
  onRemove: (product_id: number) => void;
  /**
   * A locked retry: the items of the earlier request that Pay will re-send. The
   * summary then shows those items at the quantities sent, priced by `quote` (a
   * quote for these items) only where it prices them exactly.
   */
  request?: CartLine[];
};

type Row = {
  product: ProductCard;
  quantity: number;
  /** null: no price shown (sold out, or not priced at this quantity). */
  lineTotal: string | null;
  soldOut: boolean;
  struck: number | null;
  warning: StockWarning | null;
  notice: CartNotice | undefined;
};

function stockWarningText({ name, available }: StockWarning): string {
  return available > 0
    ? `Only ${available} ${name} left. Someone bought one while you were checking out. We've changed your bag to ${available} — check the total and pay again.`
    : `${name} has just sold out. We've removed it from your bag — check the total and pay again.`;
}

function isZero(amount: string): boolean {
  return /^0+(\.0+)?$/.test(amount);
}

function bagRows(lines: CartLineQuote[], notices: Record<number, CartNotice>, stockWarning: StockWarning | null): Row[] {
  return lines.map((line) => {
    const id = line.product.id;
    const warning = stockWarning?.product_id === id ? stockWarning : null;
    const notice = warning === null ? notices[id] : undefined;
    const soldOut = line.quantity === 0;
    return {
      product: line.product,
      quantity: line.quantity,
      lineTotal: soldOut ? null : line.line_total,
      soldOut,
      struck: warning ? warning.from : notice ? notice.from : null,
      warning,
      notice,
    };
  });
}

function requestRows(items: CartLine[], quote: CartQuote | null): Row[] {
  const byId = new Map((quote?.lines ?? []).map((line) => [line.product.id, line]));
  const rows: Row[] = [];
  for (const item of items) {
    const line = byId.get(item.product_id);
    if (line === undefined) continue; // not quoted yet, or no longer sold
    const exact = line.requested === item.quantity && line.quantity === item.quantity;
    rows.push({
      product: line.product,
      quantity: item.quantity,
      lineTotal: exact ? line.line_total : null,
      soldOut: false,
      struck: null,
      warning: null,
      notice: undefined,
    });
  }
  return rows;
}

/**
 * The bag as the server quoted it: lines, delivery, total and the VAT it includes.
 * Every number is the quote's, formatted only. A stock change is shown next to the
 * line it changed, with the old quantity struck through.
 *
 * For a locked retry (`request`), it shows the earlier order being finished instead
 * of today's bag, and leaves out any total the quote can't vouch for (for example
 * when the earlier order itself holds the stock, so today's quote cuts it).
 */
export function OrderSummary({ quote, stale, notices, stockWarning, canRemove, onRemove, request }: Props) {
  const locked = request !== undefined;
  const rows = locked ? requestRows(request, quote) : bagRows(quote?.lines ?? [], notices, stockWarning);
  const showTotals = quote !== null && (!locked || quoteMatchesExactly(request, quote));
  const removedWarning =
    !locked && stockWarning !== null && !rows.some((row) => row.product.id === stockWarning.product_id)
      ? stockWarning
      : null;

  return (
    <section
      aria-labelledby="summary-heading"
      aria-busy={stale || undefined}
      data-testid="order-summary"
      className="rounded-panel bg-surface p-5 sm:p-6"
    >
      <h2 id="summary-heading" className="text-body font-semibold text-ink">
        {locked ? "Finishing your earlier order" : "Your bag"}
      </h2>

      <ul className="mt-4 divide-y divide-line/80">
        {removedWarning !== null ? (
          <li data-testid="summary-line" className="py-4 first:pt-0">
            <p className="text-callout text-muted line-through">{removedWarning.name}</p>
            <Warning testId="stock-warning">{stockWarningText(removedWarning)}</Warning>
          </li>
        ) : null}

        {rows.map((row) => (
          <li key={row.product.id} data-testid="summary-line" className="flex gap-3.5 py-4 first:pt-0 last:pb-0">
            <div className={cn("w-16 shrink-0 self-start overflow-hidden rounded-[10px]", row.soldOut && "opacity-45")}>
              <ProductImage image={row.product.image} sizes="64px" />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-caption text-muted">{row.product.brand}</p>
                  <p className="text-footnote font-medium text-ink">{row.product.name}</p>
                </div>
                {row.lineTotal !== null ? (
                  <p className={cn("shrink-0 text-footnote text-ink tabular-nums transition-opacity", stale && "opacity-50")}>
                    {formatGBP(row.lineTotal)}
                  </p>
                ) : null}
              </div>

              {row.soldOut ? (
                <div className="mt-1 flex items-center gap-3">
                  <p className="text-footnote text-danger">Sold out</p>
                  {canRemove ? (
                    <button
                      type="button"
                      onClick={() => onRemove(row.product.id)}
                      className="text-footnote text-accent hover:underline"
                      aria-label={`Remove ${row.product.name}`}
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              ) : (
                <p className="mt-1 text-footnote text-muted">
                  Qty{" "}
                  {row.struck !== null && row.struck !== row.quantity ? (
                    <>
                      <s className="text-muted">{row.struck}</s>{" "}
                    </>
                  ) : null}
                  <span data-testid="summary-quantity" className="text-ink-2 tabular-nums">
                    {row.quantity}
                  </span>
                </p>
              )}

              {row.warning ? <Warning testId="stock-warning">{stockWarningText(row.warning)}</Warning> : null}
              {row.notice ? (
                <Warning testId="stock-notice">
                  {`Only ${row.notice.to} left. We've changed your bag to ${row.notice.to}.`}
                </Warning>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      {showTotals && quote !== null ? (
        <dl className={cn("mt-5 space-y-2 border-t border-line pt-4 text-footnote transition-opacity", stale && "opacity-50")}>
          <div className="flex justify-between">
            <dt className="text-ink-2">Subtotal</dt>
            <dd className="text-ink tabular-nums">{formatGBP(quote.subtotal)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-2">Delivery</dt>
            <dd className="text-ink">{isZero(quote.delivery) ? "Free" : formatGBP(quote.delivery)}</dd>
          </div>
          <div className="flex items-baseline justify-between pt-2">
            <dt className="text-body font-semibold text-ink">Total</dt>
            <dd data-testid="summary-total" className="text-body font-semibold text-ink tabular-nums">
              {formatGBP(quote.total)}
            </dd>
          </div>
          <p className="text-caption text-muted">Includes {formatGBP(quote.vat_included)} VAT</p>
        </dl>
      ) : locked && quote !== null ? (
        <p className="mt-5 border-t border-line pt-4 text-footnote text-ink-2">
          The total is confirmed when this payment goes through.
        </p>
      ) : (
        <div aria-hidden="true" className="mt-5 h-28 border-t border-line" />
      )}
    </section>
  );
}

function Warning({ testId, children }: { testId: string; children: string }) {
  return (
    <p data-testid={testId} className="mt-2 flex gap-2 rounded-[10px] bg-low/10 px-3 py-2 text-footnote text-ink-2">
      <span aria-hidden="true" className="mt-[0.45em] size-1.5 shrink-0 rounded-full bg-low" />
      <span>{children}</span>
    </p>
  );
}
