"use client";

import { ProductImage } from "@/components/product/product-image";
import type { CartNotice } from "@/components/cart/cart-provider";
import { formatGBP } from "@/lib/money";
import type { CartQuote } from "@/lib/types";
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
};

function stockWarningText({ name, available }: StockWarning): string {
  return available > 0
    ? `Only ${available} ${name} left. Someone bought one while you were checking out. We've changed your bag to ${available} — check the total and pay again.`
    : `${name} has just sold out. We've removed it from your bag — check the total and pay again.`;
}

function isZero(amount: string): boolean {
  return /^0+(\.0+)?$/.test(amount);
}

/**
 * The bag as the server quoted it: lines, delivery, total and the VAT it includes.
 * Every number is the quote's, formatted only. A stock change is shown next to the
 * line it changed, with the old quantity struck through.
 */
export function OrderSummary({ quote, stale, notices, stockWarning, canRemove, onRemove }: Props) {
  const lines = quote?.lines ?? [];
  const warningLineShown = stockWarning !== null && lines.some((l) => l.product.id === stockWarning.product_id);

  return (
    <section
      aria-labelledby="summary-heading"
      aria-busy={stale || undefined}
      className="rounded-panel bg-surface p-5 sm:p-6"
    >
      <h2 id="summary-heading" className="text-body font-semibold text-ink">
        Your bag
      </h2>

      <ul className="mt-4 divide-y divide-line/80">
        {stockWarning !== null && !warningLineShown ? (
          <li data-testid="summary-line" className="py-4 first:pt-0">
            <p className="text-callout text-muted line-through">{stockWarning.name}</p>
            <Warning testId="stock-warning">{stockWarningText(stockWarning)}</Warning>
          </li>
        ) : null}

        {lines.map((line) => {
          const id = line.product.id;
          const soldOut = line.quantity === 0;
          const warning = stockWarning?.product_id === id ? stockWarning : null;
          const notice = warning === null ? notices[id] : undefined;
          const struck = warning ? warning.from : notice ? notice.from : null;

          return (
            <li key={id} data-testid="summary-line" className="flex gap-3.5 py-4 first:pt-0 last:pb-0">
              <div
                className={cn(
                  "w-16 shrink-0 self-start overflow-hidden rounded-[10px]",
                  soldOut && "opacity-45",
                )}
              >
                <ProductImage image={line.product.image} sizes="64px" />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-caption text-muted">{line.product.brand}</p>
                    <p className="text-footnote font-medium text-ink">{line.product.name}</p>
                  </div>
                  {!soldOut ? (
                    <p
                      className={cn(
                        "shrink-0 text-footnote text-ink tabular-nums transition-opacity",
                        stale && "opacity-50",
                      )}
                    >
                      {formatGBP(line.line_total)}
                    </p>
                  ) : null}
                </div>

                {soldOut ? (
                  <div className="mt-1 flex items-center gap-3">
                    <p className="text-footnote text-danger">Sold out</p>
                    {canRemove ? (
                      <button
                        type="button"
                        onClick={() => onRemove(id)}
                        className="text-footnote text-accent hover:underline"
                        aria-label={`Remove ${line.product.name}`}
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <p className="mt-1 text-footnote text-muted">
                    Qty{" "}
                    {struck !== null && struck !== line.quantity ? (
                      <>
                        <s className="text-muted">{struck}</s>{" "}
                      </>
                    ) : null}
                    <span data-testid="summary-quantity" className="text-ink-2 tabular-nums">
                      {line.quantity}
                    </span>
                  </p>
                )}

                {warning ? <Warning testId="stock-warning">{stockWarningText(warning)}</Warning> : null}
                {notice ? (
                  <Warning testId="stock-notice">
                    {`Only ${notice.to} left. We've changed your bag to ${notice.to}.`}
                  </Warning>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      {quote !== null ? (
        <dl
          className={cn(
            "mt-5 space-y-2 border-t border-line pt-4 text-footnote transition-opacity",
            stale && "opacity-50",
          )}
        >
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
      ) : (
        <div aria-hidden="true" className="mt-5 h-28 border-t border-line" />
      )}
    </section>
  );
}

function Warning({ testId, children }: { testId: string; children: string }) {
  return (
    <p
      data-testid={testId}
      className="mt-2 flex gap-2 rounded-[10px] bg-low/10 px-3 py-2 text-footnote text-ink-2"
    >
      <span aria-hidden="true" className="mt-[0.45em] size-1.5 shrink-0 rounded-full bg-low" />
      <span>{children}</span>
    </p>
  );
}
