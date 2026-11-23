import Link from "next/link";
import { unstable_rethrow } from "next/navigation";

import { Button } from "@/components/ui/button";
import { apiGet } from "@/lib/api";
import type { Category } from "@/lib/types";

// The six categories in nav order. Used only if the backend can't be asked, so the
// 404 page never needs the backend to render.
const FALLBACK: { slug: string; title: string }[] = [
  { slug: "keyboards", title: "Keyboards" },
  { slug: "mice", title: "Mice" },
  { slug: "monitors", title: "Monitors" },
  { slug: "audio", title: "Audio" },
  { slug: "desk", title: "Desk" },
  { slug: "cables", title: "Cables & docks" },
];

async function loadCategories(): Promise<{ slug: string; title: string }[]> {
  try {
    const categories = await apiGet<Category[]>("/categories");
    return categories.length > 0 ? categories : FALLBACK;
  } catch (error) {
    unstable_rethrow(error);
    return FALLBACK;
  }
}

export default async function NotFound() {
  const categories = await loadCategories();
  return (
    <section className="mx-auto flex w-full max-w-[560px] flex-1 flex-col items-center justify-center px-4 py-24 text-center">
      <h1 className="headline text-title-2 md:text-title-1">We couldn&apos;t find that page.</h1>
      <p className="mt-4 text-body text-muted text-pretty">
        The link may be old or mistyped. Start from home, or pick a category.
      </p>
      <Button asChild size="lg" className="mt-8">
        <Link href="/">Home</Link>
      </Button>
      <nav aria-label="Shop by category" className="mt-10">
        <ul className="flex flex-wrap justify-center gap-2">
          {categories.map((category) => (
            <li key={category.slug}>
              <Link
                href={`/c/${category.slug}`}
                className="inline-flex h-9 items-center rounded-pill bg-surface px-4 text-callout text-ink transition-colors hover:bg-[#ebebef]"
              >
                {category.title}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </section>
  );
}
