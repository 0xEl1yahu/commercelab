import Link from "next/link";

import { ProductImage } from "@/components/product/product-image";
import { Button } from "@/components/ui/button";
import { formatGBP } from "@/lib/money";
import type { ProductDetail } from "@/lib/types";

/**
 * The spotlight product as the whole first screen: a centred eyebrow, the name as the
 * headline, the tagline, Buy and Learn more, then its first photo in a large rounded
 * panel. The section fades from white to the surface grey behind the photo.
 */
export function Hero({ product }: { product: ProductDetail }) {
  const href = `/p/${product.slug}`;
  const image = product.images[0] ?? product.image;

  return (
    <section
      aria-labelledby="hero-title"
      className="bg-linear-to-b from-white from-10% via-surface via-70% to-white pt-10 md:pt-14"
    >
      <div className="shop-container flex flex-col items-center text-center">
        <p className="text-callout font-semibold text-muted">New from {product.brand}</p>
        <h1
          id="hero-title"
          className="headline mt-2 max-w-[16ch] text-title-1 md:max-w-none md:text-headline"
        >
          {product.name}
        </h1>
        <p className="mt-4 max-w-[32ch] text-body text-ink-2 md:text-title-3 md:font-normal md:tracking-[-0.015em]">
          {product.tagline}
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
          <Button asChild size="lg" className="tabular-nums">
            <Link href={href}>Buy · {formatGBP(product.price)}</Link>
          </Button>
          <Link
            href={href}
            className="text-body text-accent underline underline-offset-4 decoration-accent/40 transition-colors hover:decoration-accent"
          >
            Learn more
            <span className="sr-only"> about the {product.name}</span>
          </Link>
        </div>

        {/* Wider than the 4:3 tile frame, so the product sits above the fold on a
            laptop; the crop is taken mostly from the top of the photo. */}
        <div
          data-testid="hero-image"
          className="mt-8 w-full max-w-[980px] overflow-hidden rounded-panel md:mt-10 [&_[data-testid=product-image]]:aspect-[16/10] [&_img]:object-[50%_70%]"
        >
          <ProductImage image={image} sizes="(min-width: 1028px) 980px, 100vw" priority />
        </div>
      </div>
    </section>
  );
}
