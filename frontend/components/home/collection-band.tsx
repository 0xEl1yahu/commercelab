import { ProductTile } from "@/components/product/product-tile";
import type { CollectionDetail } from "@/lib/types";
import { cn } from "@/lib/utils";

type Props = {
  collection: CollectionDetail;
  /**
   * "grid": every product, 4 per row on desktop and 2 on mobile (Featured).
   * "row": the first 3 products, 3 up on desktop and a swipeable row on mobile.
   */
  layout: "grid" | "row";
};

/**
 * A collection as a band of product tiles. Always on white: the tiles are pale-grey
 * cards, so they need a white ground to read as cards.
 */
export function CollectionBand({ collection, layout }: Props) {
  const id = `collection-${collection.slug}`;
  const products = layout === "row" ? collection.products.slice(0, 3) : collection.products;

  return (
    <section aria-labelledby={id} className="bg-white pt-14 md:pt-20">
      <div className="shop-container">
        <div className="mb-6 flex flex-col gap-2 md:mb-8 md:flex-row md:items-end md:justify-between md:gap-12">
          <h2 id={id} className="headline text-title-2 md:text-title-1">
            {collection.title}
          </h2>
          <p className="max-w-[46ch] text-body text-muted md:text-right">{collection.description}</p>
        </div>

        <ul
          className={cn(
            layout === "grid" && "grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-5",
            layout === "row" &&
              "-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:grid md:grid-cols-3 md:gap-5 md:overflow-visible md:px-0 [&::-webkit-scrollbar]:hidden",
          )}
        >
          {products.map((product) => (
            <li
              key={product.id}
              className={cn(layout === "row" && "w-[78%] shrink-0 snap-start md:w-auto")}
            >
              <ProductTile
                product={product}
                sizes={
                  layout === "grid"
                    ? "(min-width: 1180px) 275px, (min-width: 768px) 25vw, 50vw"
                    : "(min-width: 1180px) 370px, (min-width: 768px) 33vw, 78vw"
                }
              />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
