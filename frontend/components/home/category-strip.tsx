import Link from "next/link";

import type { Category } from "@/lib/types";

/** Every category as a plain pale-grey tile, title and one line, linking to its listing. */
export function CategoryStrip({ categories }: { categories: Category[] }) {
  return (
    <section aria-labelledby="shop-by-category" className="bg-white pt-4 pb-16 md:pb-24">
      <div className="shop-container">
        <h2 id="shop-by-category" className="headline mb-6 text-title-2 md:mb-8 md:text-title-1">
          Shop by category
        </h2>
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-5">
          {categories.map((category) => (
            <li key={category.slug}>
              <Link
                href={`/c/${category.slug}`}
                className="group flex h-full min-h-32 flex-col justify-between gap-6 rounded-tile bg-surface p-4 outline-offset-4 transition-colors hover:bg-[#efeff2] sm:p-6 md:min-h-40"
              >
                <span className="text-body font-semibold tracking-[-0.015em] text-ink md:text-title-3">
                  {category.title}
                </span>
                <span className="text-footnote text-muted md:text-callout">{category.description}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
