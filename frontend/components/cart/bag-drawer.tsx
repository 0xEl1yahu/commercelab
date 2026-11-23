"use client";

// The bag drawer: a right-hand Sheet over the page, opened by Add to bag and by the
// header's Bag button. It is mounted once, in app/layout.tsx, inside <CartProvider>.
//
// Every price and total comes from the cart quote. While the quote is on its way
// (`quoting`), failed (`quoteFailed`) or doesn't describe the lines on screen, the
// numbers are shown as out of date and Check out waits.

import { CheckIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, type JSX } from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { ProductImage } from "@/components/product/product-image";
import { StockBadge } from "@/components/product/stock-badge";
import { MAX_QUANTITY } from "@/lib/cart";
import { formatGBP } from "@/lib/money";
import type { CartLineQuote } from "@/lib/types";
import { cn } from "@/lib/utils";

import { useCart } from "./cart-provider";
import { QuantityStepper } from "./quantity-stepper";

export function BagDrawer(): JSX.Element | null {
  const {
    isOpen,
    close,
    open,
    lines,
    quote,
    notices,
    lastAdded,
    hasSoldOut,
    ready,
    quoting,
    quoteFailed,
    setQuantity,
    remove,
  } = useCart();

  // The drawer lives in the layout, so it outlasts navigation: close it when the
  // route changes (the back button, a link inside it).
  const opener = useRef<HTMLElement | null>(null);
  const pathname = usePathname();
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current !== pathname) {
      lastPath.current = pathname;
      close();
    }
  }, [pathname, close]);

  const wanted = new Map(lines.map((line) => [line.product_id, line.quantity]));
  // One row per quoted line the shopper still has, plus a placeholder for a line the
  // quote hasn't described yet.
  const rows = (quote?.lines ?? []).filter((line) => wanted.has(line.product.id));
  const quotedIds = new Set(rows.map((line) => line.product.id));
  const pending = lines.filter((line) => !quotedIds.has(line.product_id));
  // A quote describes a line if it was asked for that quantity, or cut it to it.
  const inSync = pending.length === 0 && rows.every((row) => {
    const asked = wanted.get(row.product.id);
    return row.requested === asked || row.quantity === asked;
  });
  const stale = !ready || quoting || quoteFailed || !inSync;

  const added = lastAdded === null ? undefined : rows.find((row) => row.product.id === lastAdded);
  const canCheckOut = quote !== null && rows.length > 0 && !stale && !hasSoldOut;
  const empty = ready && lines.length === 0;

  return (
    <Sheet open={isOpen} onOpenChange={(next) => (next ? open() : close())}>
      <SheetContent
        side="right"
        showCloseButton={false}
        // Radix only returns focus to a <Trigger>; the drawer is opened by other
        // buttons, so remember the one that had focus and give it back on close.
        onOpenAutoFocus={() => {
          const active = document.activeElement;
          opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const target = opener.current;
          opener.current = null;
          if (target?.isConnected) target.focus();
        }}
        className={cn(
          "gap-0 p-0 text-ink",
          "data-[side=right]:w-full data-[side=right]:sm:max-w-[380px]",
          "duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
          "data-[side=right]:data-open:slide-in-from-right-full data-[side=right]:data-closed:slide-out-to-right-full",
        )}
      >
        <header className="border-b border-line px-5 sm:px-6">
          <div className="flex h-14 items-center justify-between">
            <SheetTitle className="headline text-title-3">Your bag</SheetTitle>
            {/* Our own close button: 44px to tap on a phone, 32px from sm up. */}
            <SheetClose asChild>
              <button
                type="button"
                className="-mr-3 inline-flex size-11 items-center justify-center rounded-pill text-ink outline-none transition-colors hover:bg-surface focus-visible:ring-2 focus-visible:ring-accent sm:-mr-2 sm:size-8"
              >
                <XIcon aria-hidden="true" className="size-4" />
                <span className="sr-only">Close</span>
              </button>
            </SheetClose>
          </div>
          <SheetDescription className="sr-only">Everything in your bag, with the order total.</SheetDescription>
          {added ? (
            <p role="status" className="-mt-1 flex items-start gap-1.5 pb-3 text-footnote text-ink-2">
              <CheckIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-ok" strokeWidth={2.5} />
              <span>
                Added {added.product.brand} {added.product.name}
              </span>
            </p>
          ) : null}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 sm:px-6">
          {empty ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 py-16 text-center">
              <p className="text-body text-ink">Your bag is empty.</p>
              <Button asChild variant="secondary" size="lg">
                <Link href="/" onClick={close}>
                  Continue shopping
                </Link>
              </Button>
            </div>
          ) : (
            <>
              {quoteFailed ? (
                <div
                  role="alert"
                  className="mt-4 flex items-center justify-between gap-3 rounded-tile bg-surface px-4 py-3 text-footnote"
                >
                  <p className="text-ink-2">
                    <span className="font-medium text-ink">We couldn&apos;t update your bag.</span> Prices may be out of
                    date.
                  </p>
                  <Button variant="outline" size="sm" onClick={open}>
                    Try again
                  </Button>
                </div>
              ) : null}
              <ul className="divide-y divide-line">
                {rows.map((row) => (
                  <BagLine
                    key={row.product.id}
                    line={row}
                    quantity={wanted.get(row.product.id) ?? row.quantity}
                    notice={notices[row.product.id]}
                    onQuantity={(next) => setQuantity(row.product.id, next)}
                    onRemove={() => remove(row.product.id)}
                    onNavigate={close}
                  />
                ))}
                {quoteFailed
                  ? null
                  : pending.map((line) => (
                      <li key={line.product_id} data-testid="bag-line-pending" aria-hidden="true" className="flex gap-4 py-5">
                        <div className="aspect-[4/3] w-[88px] shrink-0 animate-pulse rounded-xl bg-surface" />
                        <div className="flex-1 space-y-2.5 pt-1">
                          <div className="h-3.5 w-3/4 animate-pulse rounded-pill bg-surface" />
                          <div className="h-3 w-1/3 animate-pulse rounded-pill bg-surface" />
                        </div>
                      </li>
                    ))}
              </ul>
            </>
          )}
        </div>

        {empty ? null : (
          <footer className="border-t border-line px-5 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:px-6">
            {quote !== null && rows.length > 0 ? (
              <dl
                data-testid="bag-totals"
                aria-busy={stale}
                className={cn("space-y-1.5 text-callout transition-opacity duration-200", stale && "opacity-50")}
              >
                <div className="flex justify-between gap-4">
                  <dt className="font-medium text-ink">Subtotal</dt>
                  <dd data-testid="bag-subtotal" className="font-medium tabular-nums text-ink">
                    {formatGBP(quote.subtotal)}
                  </dd>
                </div>
                <div className="flex justify-between gap-4 text-ink-2">
                  <dt>Delivery</dt>
                  <dd data-testid="bag-delivery" className="tabular-nums">
                    {quote.delivery === "0.00" ? "Free" : formatGBP(quote.delivery)}
                  </dd>
                </div>
                {quote.delivery === "0.00" ? null : (
                  <div className="flex justify-between gap-4 font-medium text-ink">
                    <dt>Total</dt>
                    <dd className="tabular-nums">{formatGBP(quote.total)}</dd>
                  </div>
                )}
                <div className="pt-0.5 text-footnote text-muted">
                  <dt className="sr-only">VAT</dt>
                  <dd>Includes {formatGBP(quote.vat_included)} VAT</dd>
                </div>
              </dl>
            ) : null}

            <div className="mt-4 flex flex-col gap-1">
              {canCheckOut ? (
                <Button asChild size="lg" className="h-12 w-full text-body">
                  <Link href="/checkout" onClick={close}>
                    Check out
                  </Link>
                </Button>
              ) : (
                <Button size="lg" className="h-12 w-full text-body" disabled>
                  Check out
                </Button>
              )}
              <Button variant="ghost" className="h-10 w-full text-callout text-accent hover:bg-transparent hover:text-accent/80" onClick={close}>
                Continue shopping
              </Button>
            </div>
          </footer>
        )}
      </SheetContent>
    </Sheet>
  );
}

function BagLine({
  line,
  quantity,
  notice,
  onQuantity,
  onRemove,
  onNavigate,
}: {
  line: CartLineQuote;
  quantity: number;
  notice: { from: number; to: number } | undefined;
  onQuantity: (next: number) => void;
  onRemove: () => void;
  onNavigate: () => void;
}) {
  const { product } = line;
  const soldOut = line.quantity === 0;
  const href = `/p/${product.slug}`;

  return (
    <li data-testid="bag-line" className="flex gap-4 py-5">
      <Link href={href} onClick={onNavigate} aria-hidden="true" tabIndex={-1} className="w-[88px] shrink-0 self-start">
        <div className={cn("overflow-hidden rounded-xl", soldOut && "opacity-45")}>
          <ProductImage image={product.image} sizes="88px" />
        </div>
      </Link>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Link
              href={href}
              onClick={onNavigate}
              className="block text-callout leading-snug font-semibold tracking-[-0.01em] text-ink text-pretty hover:underline hover:decoration-ink/30 hover:underline-offset-4"
            >
              {product.name}
            </Link>
            <p className="mt-0.5 text-caption text-muted">{product.brand}</p>
          </div>
          {soldOut ? null : (
            <p className="shrink-0 text-callout tabular-nums text-ink">{formatGBP(line.line_total)}</p>
          )}
        </div>

        <StockBadge status={product.stock_status} left={product.stock_left} className="mt-1.5" />

        <div className="mt-3 flex items-center justify-between gap-3">
          {soldOut ? null : (
            <QuantityStepper
              size="sm"
              value={quantity}
              min={1}
              max={MAX_QUANTITY}
              label={product.name}
              onChange={onQuantity}
            />
          )}
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${product.name}`}
            className="ml-auto inline-flex min-h-11 items-center rounded-pill px-2 text-footnote sm:min-h-0 sm:px-1 sm:py-1 text-muted underline-offset-4 outline-none transition-colors hover:text-ink hover:underline focus-visible:ring-2 focus-visible:ring-accent"
          >
            Remove
          </button>
        </div>

        {soldOut ? (
          <p role="status" className="mt-2.5 text-footnote text-danger">
            Out of stock — remove it to check out.
          </p>
        ) : notice ? (
          <p role="status" className="mt-2.5 flex items-start gap-1.5 text-footnote text-ink-2">
            <span aria-hidden="true" className="mt-[7px] size-1.5 shrink-0 rounded-full bg-low" />
            {`Only ${notice.to} available — we've updated your bag.`}
          </p>
        ) : null}
      </div>
    </li>
  );
}
