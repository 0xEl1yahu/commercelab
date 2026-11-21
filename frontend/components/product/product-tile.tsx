import Link from "next/link";

import { formatGBP } from "@/lib/money";
import type { ProductCard } from "@/lib/types";
import { cn } from "@/lib/utils";

import { ProductImage } from "./product-image";
import { StockBadge } from "./stock-badge";

type Props = {
  product: ProductCard;
  /** Passed to the image; the default suits a 4-up desktop, 2-up mobile grid. */
  sizes?: string;
  priority?: boolean;
};

/**
 * A product in a grid: a white, 16px-rounded tile linking to /p/{slug}. The photo
 * sits edge to edge in its own 4:3 frame, inset 8px with concentric 8px corners, so
 * the tile reads the same on a white page or on the surface grey, with or without a
 * photo. Out-of-stock tiles dim the photo to 45%.
 */
export function ProductTile({
  product,
  sizes = "(min-width: 1024px) 280px, (min-width: 768px) 33vw, 50vw",
  priority = false,
}: Props) {
  const soldOut = product.stock_status === "out_of_stock";

  return (
    <Link
      href={`/p/${product.slug}`}
      data-testid="product-tile"
      className="group flex h-full flex-col rounded-tile bg-white p-2 outline-offset-4"
    >
      <div className={cn("rounded-[8px]", soldOut && "opacity-45")}>
        <ProductImage image={product.image} sizes={sizes} priority={priority} />
      </div>
      <div className="flex flex-1 flex-col gap-1 px-2 pt-3 pb-2 sm:px-3 sm:pb-3">
        <p className="text-caption text-muted">{product.brand}</p>
        <h3 className="text-callout font-semibold tracking-[-0.01em] text-ink text-pretty group-hover:underline group-hover:decoration-ink/30 group-hover:underline-offset-4">
          {product.name}
        </h3>
        <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-1 pt-2">
          <span className="text-callout tabular-nums text-ink">{formatGBP(product.price)}</span>
          <StockBadge status={product.stock_status} left={product.stock_left} />
        </div>
      </div>
    </Link>
  );
}
