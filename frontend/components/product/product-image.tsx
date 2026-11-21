"use client";

import NextImage from "next/image";
import { useEffect, useRef, useState } from "react";

import type { Image } from "@/lib/types";

type Props = {
  image: Image | null;
  /** The `sizes` attribute, e.g. "(min-width: 1024px) 25vw, 50vw". */
  sizes: string;
  /** Load it first (the hero, the product page's main photo). */
  priority?: boolean;
};

/**
 * A product photo in a 4:3 frame on the surface grey, edge to edge (object-cover).
 * The frame takes its corner radius from its parent (`rounded-[inherit]`), so put it
 * inside the rounded tile or panel. With no image, or when the image fails to load,
 * the plain surface tile is shown instead, never a broken-image icon.
 *
 * data-testid="product-image" is always set; data-fallback="true" marks the fallback.
 */
export function ProductImage({ image, sizes, priority = false }: Props) {
  // Remember which key failed, so switching to another image (the gallery) retries.
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const ref = useRef<HTMLImageElement>(null);
  const key = image?.key ?? null;

  // An error that happens before hydration fires no onError: check the element.
  useEffect(() => {
    const el = ref.current;
    if (key !== null && el && el.complete && el.naturalWidth === 0) {
      setFailedKey(key);
    }
  }, [key]);

  const fallback = image === null || failedKey === image.key;

  return (
    <div
      data-testid="product-image"
      data-fallback={fallback ? "true" : undefined}
      role={fallback && image !== null ? "img" : undefined}
      aria-label={fallback && image !== null ? image.alt : undefined}
      aria-hidden={image === null ? true : undefined}
      className="relative aspect-[4/3] w-full overflow-hidden rounded-[inherit] bg-surface"
    >
      {image !== null && !fallback ? (
        <NextImage
          ref={ref}
          key={image.key}
          src={`/media/${image.key}`}
          alt={image.alt}
          fill
          unoptimized
          sizes={sizes}
          preload={priority}
          className="object-cover"
          onError={() => setFailedKey(image.key)}
        />
      ) : null}
    </div>
  );
}
