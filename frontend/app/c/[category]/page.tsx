import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";

import { FilterBar } from "@/components/listing/filter-bar";
import { Pager } from "@/components/listing/pager";
import { ProductTile } from "@/components/product/product-tile";
import { apiGet } from "@/lib/api";
import {
  parseListingParams,
  toApiQuery,
  toSearch,
  type RawSearchParams,
} from "@/lib/listing-params";
import type { Category, ProductPage } from "@/lib/types";

type PageProps = {
  params: Promise<{ category: string }>;
  searchParams: Promise<RawSearchParams>;
};

// One /categories request per render, shared by the metadata and the page.
const loadCategories = cache(() => apiGet<Category[]>("/categories"));

async function findCategory(slug: string): Promise<Category> {
  const category = (await loadCategories()).find((c) => c.slug === slug);
  if (!category) notFound();
  return category;
}

export async function generateMetadata({ params }: Pick<PageProps, "params">): Promise<Metadata> {
  const category = await findCategory((await params).category);
  return { title: `${category.title} | CommerceLab`, description: category.description };
}

/**
 * A category: heading, filter bar, a grid of tiles and the pager. The URL's query
 * string is the whole state (brand, min, max, in_stock, sort, page); anything odd in
 * it is normalised by parseListingParams, so a hand-edited URL still renders.
 */
export default async function CategoryPage({ params, searchParams }: PageProps) {
  const category = await findCategory((await params).category);
  const listing = parseListingParams(await searchParams);
  const basePath = `/c/${category.slug}`;

  const { items, total, facets } = await apiGet<ProductPage>("/products", {
    query: toApiQuery(category.slug, listing),
  });

  const clearFilters = `${basePath}${toSearch({
    ...listing,
    brands: [],
    min: undefined,
    max: undefined,
    inStock: false,
    page: 1,
  })}`;

  return (
    <>
      <section className="shop-container pt-6 pb-8 md:pt-8 md:pb-10">
        <nav aria-label="Breadcrumb" className="text-footnote text-muted">
          <ol className="flex items-center gap-1.5">
            <li>
              <Link href="/" className="transition-colors hover:text-ink">
                Home
              </Link>
            </li>
            <li aria-hidden="true">›</li>
            <li aria-current="page" className="text-ink-2">
              {category.title}
            </li>
          </ol>
        </nav>
        <h1 className="headline mt-5 text-title-1 md:text-headline">{category.title}</h1>
        <p className="mt-3 max-w-xl text-body text-ink-2">{category.description}</p>
        <p className="mt-1 text-body text-muted">Free delivery on every order.</p>
      </section>

      <section className="bg-white pb-20">
        <div className="shop-container">
          <FilterBar basePath={basePath} params={listing} facets={facets} total={total} />

          <div className="pt-6 md:pt-8">
            {total === 0 ? (
              <div className="flex flex-col items-center gap-3 py-20 text-center">
                <p className="text-body text-ink-2">No products match these filters.</p>
                <Link href={clearFilters} className="text-callout font-medium text-accent hover:underline">
                  Clear filters
                </Link>
              </div>
            ) : (
              <>
                {items.length > 0 ? (
                  <ul className="grid grid-cols-2 gap-3 sm:gap-4 min-[900px]:grid-cols-4">
                    {items.map((product, index) => (
                      <li key={product.id}>
                        <ProductTile product={product} priority={index < 4} />
                      </li>
                    ))}
                  </ul>
                ) : null}
                <Pager basePath={basePath} params={listing} total={total} shown={items.length} />
              </>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
