"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";

/** After an unconfirmed payment, the same request and key are re-sent after 2 s, 4 s and 8 s. */
export const AWAITING_RECHECK_DELAYS_MS = [2000, 4000, 8000] as const;

type Props = {
  reference: string;
  token: string;
  /** The automatic re-checks are done: offer "Check again now". */
  exhausted: boolean;
  /** A re-check is on its way. */
  checking: boolean;
  onCheckAgain: () => void;
};

/**
 * Shown in place of the form when the card provider hasn't answered (the order is
 * pending). There is no Pay button here on purpose: the page re-sends the same
 * request with the same key, which can't charge twice.
 */
export function AwaitingPanel({ reference, token, exhausted, checking, onCheckAgain }: Props) {
  return (
    <section
      data-testid="awaiting-panel"
      aria-labelledby="awaiting-heading"
      className="rounded-panel border border-line px-6 py-8 sm:px-8 sm:py-10"
    >
      <span
        aria-hidden="true"
        className="block size-7 animate-spin rounded-full border-2 border-line border-t-accent"
      />
      <h2 id="awaiting-heading" className="headline mt-6 text-title-3">
        We&apos;re confirming your payment.
      </h2>
      <p className="mt-3 max-w-[52ch] text-callout text-ink-2">
        Your card provider hasn&apos;t replied yet. Your items are held for you while we check.
        Don&apos;t pay again: this page updates on its own, and you won&apos;t be charged twice.
      </p>

      {reference ? (
        <div className="mt-6 inline-flex flex-col rounded-[12px] bg-surface px-4 py-3">
          <span className="text-caption text-muted">Order reference</span>
          <span className="text-body font-semibold text-ink tabular-nums">{reference}</span>
        </div>
      ) : null}

      <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-3">
        {exhausted ? (
          <Button type="button" size="lg" onClick={onCheckAgain} disabled={checking} aria-busy={checking}>
            {checking ? "Checking…" : "Check again now"}
          </Button>
        ) : null}
        <Link href={`/orders/${token}`} className="text-callout text-accent hover:underline">
          View your order
        </Link>
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {checking ? "Checking your payment." : ""}
      </p>
    </section>
  );
}
