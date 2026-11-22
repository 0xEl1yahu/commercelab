import Link from "next/link";
import { unstable_rethrow } from "next/navigation";

import { BagButton } from "@/components/cart/bag-button";
import { apiGet } from "@/lib/api";
import type { Category } from "@/lib/types";

type Props = {
  /** "checkout": the wordmark and "Secure checkout" only, no shop navigation and no bag. */
  variant?: "shop" | "checkout";
};

async function loadCategories(): Promise<Category[]> {
  try {
    return await apiGet<Category[]>("/categories");
  } catch (error) {
    unstable_rethrow(error); // let Next's own signals (dynamic rendering, 404) through
    // The backend is down. The header still renders, without category links, and the
    // page below it fails into app/error.tsx: the header lives in the root layout,
    // which app/error.tsx can't catch, so it must not throw.
    return [];
  }
}

function Wordmark() {
  return (
    <Link
      href="/"
      className="text-[1.1875rem] leading-none font-semibold tracking-[-0.035em] text-ink"
    >
      CommerceLab
    </Link>
  );
}

/**
 * The sticky shop header: wordmark, category links (from GET /categories, in nav
 * order) and the bag. Only app/layout.tsx mounts it, through ShopHeaderSlot: the
 * shop variant everywhere, the checkout variant on /checkout. Pages never render it.
 *
 * The shop header's rendered height, border included, is exactly var(--header-height):
 * 52px from md up, 92px below md (where the categories take a second, scrollable
 * row). Use it for sticky offsets such as the product page's buy box. The checkout
 * header is 52px at every width.
 */
export async function SiteHeader({ variant = "shop" }: Props) {
  if (variant === "checkout") {
    return (
      <header className="sticky top-0 z-40 box-border h-[52px] border-b border-line bg-white/80 backdrop-blur-xl backdrop-saturate-150">
        <div className="shop-container flex h-full items-center justify-between">
          <Wordmark />
          <p className="inline-flex items-center gap-1.5 text-footnote text-ink-2">
            <LockGlyph />
            Secure checkout
          </p>
        </div>
      </header>
    );
  }

  const categories = await loadCategories();

  return (
    <header className="sticky top-0 z-40 box-border h-[var(--header-height)] border-b border-line bg-white/80 backdrop-blur-xl backdrop-saturate-150">
      {/* Content box = header height − 1px border: a 51px row, plus a 40px row below md. */}
      <div className="shop-container flex h-full flex-wrap items-start justify-between md:flex-nowrap md:items-center md:gap-8">
        <div className="flex h-[51px] items-center md:h-full">
          <Wordmark />
        </div>
        <div className="order-2 flex h-[51px] items-center md:order-3 md:h-full">
          <BagButton />
        </div>
        <nav
          aria-label="Categories"
          className="order-3 -mx-4 h-10 basis-[calc(100%+2rem)] overflow-x-auto px-4 [scrollbar-width:none] md:order-2 md:mx-0 md:h-auto md:flex-1 md:basis-auto md:overflow-visible md:px-0 [&::-webkit-scrollbar]:hidden"
        >
          <ul className="flex h-full items-center gap-6 md:justify-center md:gap-8">
            {categories.map((category) => (
              <li key={category.slug} className="shrink-0">
                <Link
                  href={`/c/${category.slug}`}
                  className="text-footnote whitespace-nowrap text-ink-2 transition-colors hover:text-ink"
                >
                  {category.title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </header>
  );
}

function LockGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3.5" fill="none">
      <rect x="3.5" y="7" width="9" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}
