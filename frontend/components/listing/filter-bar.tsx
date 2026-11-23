"use client";

import { ChevronDown, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useOptimistic, useRef, useState, useTransition } from "react";

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { SORTS, SORT_LABELS, toSearch, type ListingParams, type Sort } from "@/lib/listing-params";
import type { ProductPage } from "@/lib/types";
import { cn } from "@/lib/utils";

type Props = {
  /** The listing's path, e.g. /c/keyboards. Every change navigates to this path plus a query. */
  basePath: string;
  params: ListingParams;
  facets: ProductPage["facets"];
  total: number;
};

// Display only: "£50", or "£49.50" when the pence matter.
const priceFormat = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});
const shortGBP = (amount: string | number) => priceFormat.format(Number(amount));

/** How long the price slider waits after the last change before it navigates. */
const PRICE_SETTLE_MS = 250;

const chip =
  "inline-flex h-9 items-center gap-1.5 rounded-pill border border-input bg-white px-3.5 text-callout text-ink outline-none transition-colors hover:bg-surface focus-visible:ring-3 focus-visible:ring-ring/40 data-[state=open]:bg-surface";

/**
 * The filter bar: Brand and Price dropdowns, an "In stock only" switch, the active
 * filters as removable pills, and the result count and Sort on the right.
 *
 * The URL is the state. Every control builds the next URL with toSearch and pushes it;
 * the server page re-renders with the API's answer. useOptimistic makes the controls
 * respond at once while that happens. Any filter or sort change goes back to page 1.
 */
export function FilterBar({ basePath, params, facets, total }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [current, setCurrent] = useOptimistic(params);

  const go = (next: ListingParams) => {
    const target: ListingParams = { ...next, page: 1 };
    startTransition(() => {
      setCurrent(target);
      router.push(`${basePath}${toSearch(target)}`, { scroll: false });
    });
  };

  const hrefWith = (change: Partial<ListingParams>) =>
    `${basePath}${toSearch({ ...params, ...change, page: 1 })}`;

  const hasPrice = current.min !== undefined || current.max !== undefined;
  const pillCount = current.brands.length + (hasPrice ? 1 : 0);
  const anyFilter = pillCount > 0 || current.inStock;

  const toggleBrand = (brand: string, on: boolean) =>
    go({
      ...current,
      brands: on ? [...current.brands, brand] : current.brands.filter((b) => b !== brand),
    });

  const stockId = useId();

  return (
    <div className="border-b border-line pb-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {facets.brands.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger className={chip}>
                Brand
                {current.brands.length > 0 ? (
                  <span className="text-accent tabular-nums">{current.brands.length}</span>
                ) : null}
                <ChevronDown aria-hidden="true" className="size-3.5 text-muted" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-auto min-w-48 p-1.5">
                {facets.brands.map((brand) => (
                  <DropdownMenuCheckboxItem
                    key={brand}
                    checked={current.brands.includes(brand)}
                    onCheckedChange={(on) => toggleBrand(brand, on)}
                    // Keep the menu open, so several brands can be ticked in one go.
                    onSelect={(event) => event.preventDefault()}
                    className="py-2 text-callout"
                  >
                    {brand}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}

          <PriceFilter current={current} facets={facets} onChange={go} />

          <div className="flex h-9 items-center gap-2.5 pl-2">
            <Switch
              id={stockId}
              checked={current.inStock}
              onCheckedChange={(on) => go({ ...current, inStock: on })}
            />
            <label htmlFor={stockId} className="text-callout text-ink-2 select-none">
              In stock only
            </label>
          </div>
        </div>

        <div className="ml-auto flex w-full items-center justify-between gap-4 sm:w-auto sm:justify-end">
          <p
            data-testid="result-count"
            aria-live="polite"
            className={cn(
              "text-footnote text-muted tabular-nums transition-opacity",
              pending && "opacity-50",
            )}
          >
            {total === 1 ? "1 result" : `${total} results`}
          </p>
          <DropdownMenu>
            <DropdownMenuTrigger className={cn(chip, "gap-1.5")}>
              <span className="text-muted">Sort</span>
              {SORT_LABELS[current.sort]}
              <ChevronDown aria-hidden="true" className="size-3.5 text-muted" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-auto min-w-52 p-1.5">
              <DropdownMenuRadioGroup
                value={current.sort}
                onValueChange={(value) => go({ ...current, sort: value as Sort })}
              >
                {SORTS.map((sort) => (
                  <DropdownMenuRadioItem key={sort} value={sort} className="py-2 text-callout">
                    {SORT_LABELS[sort]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {pillCount > 0 ? (
        <ul aria-label="Active filters" className="mt-3 flex flex-wrap items-center gap-2">
          {current.brands.map((brand) => (
            <li key={brand}>
              <Pill
                href={hrefWith({ brands: params.brands.filter((b) => b !== brand) })}
                label={brand}
                aria={`Remove ${brand} filter`}
              />
            </li>
          ))}
          {hasPrice ? (
            <li>
              <Pill
                href={hrefWith({ min: undefined, max: undefined })}
                label={priceText(current, " – ", "From ", "Up to ")}
                aria={`Remove price filter: ${priceText(current, " to ", "from ", "up to ")}`}
              />
            </li>
          ) : null}
          {anyFilter ? (
            <li>
              <Link
                href={hrefWith({ brands: [], min: undefined, max: undefined, inStock: false })}
                className="px-1 text-footnote text-accent hover:underline"
              >
                Clear all
              </Link>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

function priceText(p: ListingParams, between: string, from: string, upTo: string): string {
  if (p.min !== undefined && p.max !== undefined) {
    return `${shortGBP(p.min)}${between}${shortGBP(p.max)}`;
  }
  if (p.min !== undefined) return `${from}${shortGBP(p.min)}`;
  return `${upTo}${shortGBP(p.max ?? "0")}`;
}

function Pill({ href, label, aria }: { href: string; label: string; aria: string }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-label={aria}
      className="group inline-flex h-8 items-center gap-1.5 rounded-pill bg-surface pr-2 pl-3.5 text-footnote text-ink transition-colors hover:bg-[#ebebef]"
    >
      {label}
      <span className="flex size-4 items-center justify-center rounded-full text-muted group-hover:text-ink">
        <X aria-hidden="true" className="size-3" strokeWidth={2.25} />
      </span>
    </Link>
  );
}

/**
 * The price popover: a two-thumb slider bounded by the category's facets, in whole
 * pounds. Moving a thumb only changes the draft; the filter is applied once the
 * slider has settled, so a drag or a run of key presses is one navigation.
 */
function PriceFilter({
  current,
  facets,
  onChange,
}: {
  current: ListingParams;
  facets: Props["facets"];
  onChange: (next: ListingParams) => void;
}) {
  const low = facets.min_price === null ? NaN : Math.floor(Number(facets.min_price));
  const high = facets.max_price === null ? NaN : Math.ceil(Number(facets.max_price));

  const fromUrl: [number, number] = [
    clamp(current.min === undefined ? low : Number(current.min), low, high),
    clamp(current.max === undefined ? high : Number(current.max), low, high),
  ];
  const urlKey = `${current.min ?? ""}|${current.max ?? ""}`;
  // The draft belongs to the URL it was made against: once the URL moves on (a pill
  // was removed, the slider's own change landed), the URL's values win again.
  const [draft, setDraft] = useState<{ key: string; values: [number, number] } | null>(null);
  const values = draft !== null && draft.key === urlKey ? draft.values : fromUrl;

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  if (!Number.isFinite(low) || !Number.isFinite(high) || low >= high) return null;

  const apply = ([from, to]: number[]) => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      onChange({
        ...current,
        // A thumb at its end of the range means "no limit on that side".
        min: from <= low ? undefined : String(from),
        max: to >= high ? undefined : String(to),
      });
    }, PRICE_SETTLE_MS);
  };

  const active = current.min !== undefined || current.max !== undefined;

  return (
    <Popover>
      <PopoverTrigger className={chip}>
        Price
        {active ? <span className="size-1.5 rounded-full bg-accent" aria-hidden="true" /> : null}
        <ChevronDown aria-hidden="true" className="size-3.5 text-muted" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 gap-4 rounded-panel p-5">
        <div className="flex items-baseline justify-between text-callout tabular-nums text-ink">
          <span>{shortGBP(values[0])}</span>
          <span className="text-muted">to</span>
          <span>{shortGBP(values[1])}</span>
        </div>
        <Slider
          min={low}
          max={high}
          step={1}
          minStepsBetweenThumbs={0}
          value={values}
          onValueChange={(next) => setDraft({ key: urlKey, values: [next[0], next[1]] })}
          onValueCommit={apply}
          aria-label="Price range"
        />
      </PopoverContent>
    </Popover>
  );
}

function clamp(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) return low;
  return Math.min(Math.max(value, low), high);
}
