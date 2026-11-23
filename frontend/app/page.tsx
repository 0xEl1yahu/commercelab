import { CategoryStrip } from "@/components/home/category-strip";
import { CollectionBand } from "@/components/home/collection-band";
import { Hero } from "@/components/home/hero";
import { apiGet } from "@/lib/api";
import type { Category, CollectionDetail, ProductDetail } from "@/lib/types";

/**
 * The home page: the spotlight product as the hero, then Featured, The quiet desk and
 * every category. All of it comes from the API on each request (stock changes). If the
 * backend can't be reached, the page fails into app/error.tsx.
 */
export default async function HomePage() {
  const [spotlight, featured, quietDesk, categories] = await Promise.all([
    apiGet<CollectionDetail>("/collections/spotlight"),
    apiGet<CollectionDetail>("/collections/featured"),
    apiGet<CollectionDetail>("/collections/quiet-desk"),
    apiGet<Category[]>("/categories"),
  ]);

  const heroSlug = spotlight.products[0]?.slug;
  const hero = heroSlug
    ? await apiGet<ProductDetail>(`/products/by-slug/${encodeURIComponent(heroSlug)}`)
    : null;

  return (
    <>
      {hero ? <Hero product={hero} /> : null}
      <CollectionBand collection={featured} layout="grid" />
      <CollectionBand collection={quietDesk} layout="row" />
      <CategoryStrip categories={categories} />
    </>
  );
}
