"use client";

import { useState } from "react";

import { QuantityStepper } from "@/components/cart/quantity-stepper";
import { useCart } from "@/components/cart/cart-provider";
import { Button } from "@/components/ui/button";
import { formatGBP } from "@/lib/money";
import type { ProductDetail } from "@/lib/types";
import { cn } from "@/lib/utils";

import { purchaseLimit } from "./buy-limit";
import { StockBadge } from "./stock-badge";

const PROMISES = [
  // Worded as in the site footer.
  { title: "Free UK delivery", note: "On every order, with no minimum spend." },
  { title: "30-day returns", note: "Send back anything unused in its original packaging." },
  { title: "2-year warranty", note: "On every product, from the brand that makes it." },
] as const;

/**
 * Brand, name, price, VAT line, stock, quantity and Add to bag, then the three promise
 * lines. It stays in view while the page scrolls, one header height plus 16px from the
 * top. Every number shown is the API's; the quantity bound is only a convenience.
 */
export function BuyBox({ product, className }: { product: ProductDetail; className?: string }) {
  const { add, open } = useCart();
  const soldOut = product.stock_status === "out_of_stock";
  const limit = purchaseLimit(product.stock_left);
  const [quantity, setQuantity] = useState(1);

  const addToBag = () => {
    add(product.id, quantity);
    open();
  };

  return (
    <section
      data-testid="buy-box"
      aria-label="Buy"
      className={cn("sticky top-[calc(var(--header-height)+16px)] self-start", className)}
    >
      <p className="text-callout text-muted">{product.brand}</p>
      <h1 className="headline mt-1 text-title-2">{product.name}</h1>

      <p className="mt-5 text-title-3 font-semibold tracking-[-0.02em] tabular-nums text-ink">
        {formatGBP(product.price)}
      </p>
      <p className="mt-1 text-footnote text-muted">Includes {formatGBP(product.vat_included)} VAT</p>

      <div className="mt-5">
        <StockBadge status={product.stock_status} left={product.stock_left} className="text-footnote" />
      </div>

      <div className="mt-6 flex flex-col gap-3">
        {soldOut ? null : (
          <QuantityStepper
            value={quantity}
            min={1}
            max={limit}
            onChange={setQuantity}
            className="w-full justify-between"
          />
        )}
        <Button size="lg" className="h-12 w-full text-body" disabled={soldOut} onClick={addToBag}>
          {soldOut ? "Out of stock" : "Add to bag"}
        </Button>
      </div>

      <ul className="mt-8 divide-y divide-line border-y border-line">
        {PROMISES.map((promise) => (
          <li key={promise.title} className="py-3.5">
            <p className="text-footnote font-medium text-ink">{promise.title}</p>
            <p className="mt-0.5 text-footnote text-muted">{promise.note}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
