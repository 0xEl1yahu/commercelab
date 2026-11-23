import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { apiGet, notFoundOn404 } from "@/lib/api";
import { formatGBP } from "@/lib/money";
import type { Order } from "@/lib/types";

export const metadata: Metadata = {
  title: "Your order · CommerceLab",
  robots: { index: false },
};

type Props = { params: Promise<{ token: string }> };

export default async function OrderPage({ params }: Props) {
  const { token } = await params;
  const order = await notFoundOn404(apiGet<Order>(`/orders/${encodeURIComponent(token)}`));

  return (
    <section className="flex flex-1 justify-center px-4 py-12 md:py-20">
      <div className="w-full max-w-[560px]">
        <ByStatus order={order} />
      </div>
    </section>
  );
}

function ByStatus({ order }: { order: Order }) {
  const status = order.status;
  switch (status) {
    case "paid":
    case "fulfilled":
      return <Paid order={order} />;
    case "pending":
      return <Pending order={order} />;
    case "cancelled":
      return <Cancelled order={order} />;
    default: {
      // A new status in the API breaks the build here instead of showing the wrong page.
      const unhandled: never = status;
      throw new Error(`Unhandled order status: ${String(unhandled)}`);
    }
  }
}

function Reference({ reference }: { reference: string }) {
  return (
    <div className="rounded-panel bg-surface px-5 py-4 text-center">
      <p className="text-caption text-muted">Order reference</p>
      <p data-testid="order-reference" className="mt-1 text-title-3 font-semibold tracking-[-0.02em] tabular-nums">
        {reference}
      </p>
    </div>
  );
}

function Tick() {
  return (
    <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-ok text-white" aria-hidden="true">
      <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12.5 10 17.5 19 7.5" />
      </svg>
    </span>
  );
}

function Paid({ order }: { order: Order }) {
  const firstName = order.customer_name.trim().split(/\s+/)[0] ?? "";
  const { address } = order;

  return (
    <div className="flex flex-col gap-8">
      <header className="text-center">
        <Tick />
        <h1 className="headline mt-6 text-title-2 md:text-title-1">
          Thank you{firstName ? `, ${firstName}` : ""}. Your order is placed.
        </h1>
        <p className="mt-4 text-body text-muted text-pretty">
          Payment received. Keep this page&apos;s link if you&apos;d like to check your order later.
        </p>
      </header>

      <Reference reference={order.reference} />

      <ul className="flex flex-col divide-y divide-line border-y border-line">
        {order.items.map((item) => (
          <li
            key={item.product_id}
            data-testid="order-line"
            className="flex items-baseline justify-between gap-4 py-3.5 text-callout"
          >
            <span className="min-w-0 text-ink">
              {item.product_name} × {item.quantity}
            </span>
            <span className="shrink-0 tabular-nums text-ink">{formatGBP(item.line_total)}</span>
          </li>
        ))}
      </ul>

      <dl className="flex flex-col gap-2 text-callout">
        <div data-testid="order-delivery" className="flex justify-between gap-4 text-ink-2">
          <dt>Delivery</dt> <dd>{order.delivery === "0.00" ? "Free" : formatGBP(order.delivery)}</dd>
        </div>
        <div data-testid="order-total" className="flex justify-between gap-4 text-body font-semibold text-ink">
          <dt>Total paid</dt> <dd className="tabular-nums">{formatGBP(order.total)}</dd>
        </div>
        <div data-testid="order-vat" className="flex justify-between gap-4 text-footnote text-muted">
          <dt>Includes VAT</dt> <dd className="tabular-nums">{formatGBP(order.vat_included)}</dd>
        </div>
      </dl>

      {address ? (
        <div data-testid="order-address" className="rounded-panel bg-surface px-5 py-4 text-callout">
          <h2 className="text-footnote font-semibold text-ink">Delivering to</h2>
          <address className="mt-2 leading-relaxed text-ink-2 not-italic">
            {address.name}
            {address.company ? (
              <>
                <br />
                {address.company}
              </>
            ) : null}
            <br />
            {address.line1}
            {address.line2 ? (
              <>
                <br />
                {address.line2}
              </>
            ) : null}
            <br />
            {address.city} {address.postcode}
          </address>
        </div>
      ) : null}

      <div className="text-center">
        <Button asChild size="lg">
          <Link href="/">Continue shopping</Link>
        </Button>
      </div>
    </div>
  );
}

function Pending({ order }: { order: Order }) {
  return (
    <div className="flex flex-col gap-8 text-center">
      <header>
        <h1 className="headline text-title-2 md:text-title-1">We&apos;re confirming your payment.</h1>
        <p className="mt-4 text-body text-muted text-pretty">
          Don&apos;t pay again. Your order is saved under the reference below. Check this page again in a few
          minutes.
        </p>
      </header>
      <Reference reference={order.reference} />
    </div>
  );
}

function Cancelled({ order }: { order: Order }) {
  return (
    <div className="flex flex-col gap-8 text-center">
      <header>
        <h1 className="headline text-title-2 md:text-title-1">This order was cancelled. You weren&apos;t charged.</h1>
        <p className="mt-4 text-body text-muted text-pretty">Reference {order.reference}.</p>
      </header>
      <div>
        <Button asChild size="lg">
          <Link href="/">Back to the shop</Link>
        </Button>
      </div>
    </div>
  );
}
