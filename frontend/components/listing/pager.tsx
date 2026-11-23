import Link from "next/link";

import { PAGE_SIZE, toSearch, type ListingParams } from "@/lib/listing-params";
import { cn } from "@/lib/utils";

type Props = {
  /** The listing's path, e.g. /c/keyboards. */
  basePath: string;
  params: ListingParams;
  /** Every match, not just this page (ProductPage.total). */
  total: number;
  /** How many tiles this page shows. */
  shown: number;
};

const hrefFor = (basePath: string, params: ListingParams, page: number) =>
  `${basePath}${toSearch({ ...params, page })}`;

/**
 * "Showing 1–8 of 9", then the page links. The page count is just ceil(total / page
 * size) for drawing the links; which products are on a page is the API's call.
 * A page past the last shows "Nothing on this page." with a way back to page 1.
 */
export function Pager({ basePath, params, total, shown }: Props) {
  if (total === 0) return null;

  if (shown === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <p className="text-body text-ink-2">Nothing on this page.</p>
        <Link
          href={hrefFor(basePath, params, 1)}
          className="rounded-pill text-callout font-medium text-accent hover:underline"
        >
          Go to page 1
        </Link>
      </div>
    );
  }

  const pages = Math.ceil(total / PAGE_SIZE);
  const from = (params.page - 1) * PAGE_SIZE + 1;
  const to = from + shown - 1;

  return (
    <div className="mt-10 flex flex-col items-center gap-5 sm:mt-12 sm:flex-row sm:justify-between">
      <p className="text-footnote text-muted tabular-nums">
        Showing {from}–{to} of {total}
      </p>
      {pages > 1 ? (
        <nav aria-label="Pages">
          <ul className="flex items-center gap-1">
            <li>
              <StepLink
                href={hrefFor(basePath, params, params.page - 1)}
                disabled={params.page <= 1}
                label="Previous page"
                direction="prev"
              />
            </li>
            {Array.from({ length: pages }, (_, i) => i + 1).map((page) => {
              const current = page === params.page;
              return (
                <li key={page}>
                  <Link
                    href={hrefFor(basePath, params, page)}
                    aria-label={`Page ${page}`}
                    aria-current={current ? "page" : undefined}
                    className={cn(
                      "flex size-9 items-center justify-center rounded-full text-callout tabular-nums transition-colors",
                      current ? "bg-ink font-medium text-white" : "text-ink-2 hover:bg-surface",
                    )}
                  >
                    {page}
                  </Link>
                </li>
              );
            })}
            <li>
              <StepLink
                href={hrefFor(basePath, params, params.page + 1)}
                disabled={params.page >= pages}
                label="Next page"
                direction="next"
              />
            </li>
          </ul>
        </nav>
      ) : null}
    </div>
  );
}

function StepLink({
  href,
  disabled,
  label,
  direction,
}: {
  href: string;
  disabled: boolean;
  label: string;
  direction: "prev" | "next";
}) {
  const chevron = (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4" fill="none">
      <path
        d={direction === "prev" ? "M10 3.5 5.5 8l4.5 4.5" : "M6 3.5 10.5 8 6 12.5"}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
  const base = "flex size-9 items-center justify-center rounded-full";
  if (disabled) {
    return (
      <span aria-hidden="true" className={cn(base, "text-line")}>
        {chevron}
      </span>
    );
  }
  return (
    <Link
      href={href}
      aria-label={label}
      className={cn(base, "text-ink-2 transition-colors hover:bg-surface")}
    >
      {chevron}
    </Link>
  );
}
