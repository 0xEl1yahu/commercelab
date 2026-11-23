"use client";

import { useState } from "react";

import type { Image } from "@/lib/types";
import { cn } from "@/lib/utils";

import { ProductImage } from "./product-image";

/**
 * The product page's photos: one large image in an 18px panel, thumbnails below it
 * that switch it. With one image there are no thumbnails; with none, the surface tile.
 */
export function Gallery({ images }: { images: Image[] }) {
  const [index, setIndex] = useState(0);
  const current = images[index] ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div data-testid="gallery-main" className="overflow-hidden rounded-panel bg-surface">
        <ProductImage image={current} sizes="(min-width: 1024px) 720px, 100vw" priority />
      </div>

      {images.length > 1 ? (
        <ul className="-m-1 flex gap-3 overflow-x-auto p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {images.map((image, i) => (
            <li key={image.key} className="w-[76px] shrink-0 sm:w-24">
              <button
                type="button"
                aria-label={`Show image ${i + 1} of ${images.length}`}
                aria-pressed={i === index}
                onClick={() => setIndex(i)}
                className={cn(
                  "block w-full overflow-hidden rounded-xl bg-surface outline-none transition-shadow",
                  "focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2",
                  i === index ? "ring-2 ring-ink ring-offset-2" : "opacity-80 ring-1 ring-line hover:opacity-100",
                )}
              >
                <ProductImage image={image} sizes="96px" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
