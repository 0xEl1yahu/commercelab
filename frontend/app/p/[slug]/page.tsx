import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";

import { BuyBox } from "@/components/product/buy-box";
import { Gallery } from "@/components/product/gallery";
import { apiGet, notFoundOn404 } from "@/lib/api";
import type { ProductDetail } from "@/lib/types";

type Props = { params: Promise<{ slug: string }> };

// One request for the page and its metadata.
const loadProduct = cache((slug: string) =>
  notFoundOn404(apiGet<ProductDetail>(`/products/by-slug/${encodeURIComponent(slug)}`)),
);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const product = await loadProduct(slug);
  return {
    title: `${product.brand} ${product.name} — CommerceLab`,
    description: product.tagline,
  };
}

export default async function ProductPage({ params }: Props) {
  const { slug } = await params;
  const product = await loadProduct(slug);

  return (
    <div className="shop-container pt-5 pb-16 md:pt-8 md:pb-24">
      <nav aria-label="Breadcrumb" className="text-footnote text-muted">
        <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <li>
            <Link href="/" className="hover:text-ink">
              Home
            </Link>
          </li>
          <li aria-hidden="true">›</li>
          <li>
            <Link href={`/c/${product.category}`} className="hover:text-ink">
              {product.category_title}
            </Link>
          </li>
          <li aria-hidden="true">›</li>
          <li aria-current="page" className="text-ink-2">
            {product.name}
          </li>
        </ol>
      </nav>

      {/* One column on a phone (photo, buy box, details); from lg the photo and the
          details share the left column and the buy box sticks beside them. */}
      <div className="mt-5 grid gap-x-14 gap-y-8 md:mt-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-y-16">
        <div className="lg:col-start-1 lg:row-start-1">
          <Gallery images={product.images} />
        </div>

        <BuyBox product={product} className="lg:col-start-2 lg:row-span-2 lg:row-start-1" />

        <div className="flex flex-col gap-12 lg:col-start-1 lg:row-start-2 lg:max-w-[680px]">
          <section aria-labelledby="about-heading">
            <h2 id="about-heading" className="headline text-title-3">
              About this
            </h2>
            <p className="mt-4 text-body text-ink-2 text-pretty">{product.description}</p>
          </section>

          {product.specs.length > 0 ? (
            <section aria-labelledby="specs-heading">
              <h2 id="specs-heading" className="headline text-title-3">
                Specifications
              </h2>
              <table className="mt-4 w-full border-collapse text-callout">
                <tbody>
                  {product.specs.map((spec) => (
                    <tr key={spec.label} className="border-y border-line align-top">
                      <th scope="row" className="w-2/5 py-3.5 pr-4 text-left font-normal text-muted">
                        {spec.label}
                      </th>
                      <td className="py-3.5 text-ink">{spec.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
