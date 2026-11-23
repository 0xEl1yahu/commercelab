import Link from "next/link";

import type { Category } from "@/lib/types";

/** Every category as a plain pale-grey tile, title and one line, linking to its listing. */
export function CategoryStrip({ categories }: { categories: Category[] }) {
  return (
    <section aria-labelledby="shop-by-category" className="bg-white pt-14 pb-16 md:pt-20 md:pb-24">
      <div className="shop-container">
        <h2 id="shop-by-category" className="headline mb-6 text-title-2 md:mb-8 md:text-title-1">
          Shop by category
        </h2>
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-5">
          {categories.map((category) => (
            <li key={category.slug}>
              <Link
                href={`/c/${category.slug}`}
                className="group flex h-full flex-col gap-1 rounded-tile bg-surface p-4 outline-offset-4 transition-colors duration-200 hover:bg-line/70 sm:p-5 md:p-6"
              >
                <span className="flex items-baseline justify-between gap-3">
                  <span className="text-body font-semibold tracking-[-0.015em] text-ink md:text-title-3">
                    {category.title}
                  </span>
                  <span
                    aria-hidden="true"
                    className="text-callout text-muted transition-transform duration-200 ease-out group-hover:translate-x-1 group-hover:text-ink motion-reduce:transition-none"
                  >
                    →
                  </span>
                </span>
                <span className="text-footnote text-pretty text-muted md:text-callout">
                  {category.description}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
