// The listing page's URL state: ?brand=…&min=…&max=…&in_stock=1&sort=…&page=…
//
// This module only normalises what a shopper (or a hand-edited URL) puts in the query
// string, and maps it onto the API's parameters. It decides nothing about the catalogue:
// filtering, sorting, totals and facets are the backend's. Pure, so it is safe to import
// from both Server and Client Components.

import type { operations } from "./api-types";

export const PAGE_SIZE = 8;

/** Far beyond any real catalogue; stops a hand-edited ?page=9999999999999 becoming a huge offset. */
const MAX_PAGE = 10_000;

// Taken from the generated API types, so a changed sort enum breaks the build here.
export type Sort = NonNullable<
  NonNullable<operations["list_products_products_get"]["parameters"]["query"]>["sort"]
>;

export const SORTS: readonly Sort[] = ["featured", "name", "price_asc", "price_desc"];

export const SORT_LABELS: Record<Sort, string> = {
  featured: "Featured",
  name: "Name",
  price_asc: "Price: low to high",
  price_desc: "Price: high to low",
};

export type ListingParams = {
  brands: string[];
  min?: string;
  max?: string;
  inStock: boolean;
  sort: Sort;
  page: number;
};

/** What Next hands a page as `searchParams`. */
export type RawSearchParams = Record<string, string | string[] | undefined>;

type ApiQuery = Record<string, string | string[] | undefined>;

const PRICE = /^\d+(\.\d{1,2})?$/;
const WHOLE_NUMBER = /^\d+$/;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parsePrice(value: string | string[] | undefined): string | undefined {
  const raw = first(value);
  return raw !== undefined && PRICE.test(raw) ? raw : undefined;
}

function parseSort(value: string | string[] | undefined): Sort {
  const raw = first(value);
  return SORTS.includes(raw as Sort) ? (raw as Sort) : "featured";
}

function parsePage(value: string | string[] | undefined): number {
  const raw = first(value);
  if (raw === undefined || !WHOLE_NUMBER.test(raw)) return 1;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, MAX_PAGE);
}

function parseBrands(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  const seen = new Set<string>();
  for (const item of Array.isArray(value) ? value : [value]) {
    const brand = item.trim();
    if (brand !== "") seen.add(brand);
  }
  return [...seen];
}

/** Turns whatever is in the URL into safe listing parameters. Never throws. */
export function parseListingParams(sp: RawSearchParams): ListingParams {
  let min = parsePrice(sp.min);
  let max = parsePrice(sp.max);
  // Reversed bounds are swapped, not rejected: ?min=200&max=50 means 50 to 200.
  if (min !== undefined && max !== undefined && Number(min) > Number(max)) {
    [min, max] = [max, min];
  }
  const inStock = first(sp.in_stock);
  return {
    brands: parseBrands(sp.brand),
    min,
    max,
    inStock: inStock === "1" || inStock === "true",
    sort: parseSort(sp.sort),
    page: parsePage(sp.page),
  };
}

/** The query for GET /products. Unset filters are left out (undefined values are skipped). */
export function toApiQuery(category: string, p: ListingParams): ApiQuery {
  return {
    category,
    brand: p.brands.length > 0 ? p.brands : undefined,
    min_price: p.min,
    max_price: p.max,
    in_stock: p.inStock ? "true" : undefined,
    sort: p.sort,
    limit: String(PAGE_SIZE),
    offset: String((p.page - 1) * PAGE_SIZE),
  };
}

/** The inverse of parseListingParams: "" for the defaults, otherwise "?…". */
export function toSearch(p: ListingParams): string {
  const params = new URLSearchParams();
  for (const brand of p.brands) params.append("brand", brand);
  if (p.min !== undefined) params.set("min", p.min);
  if (p.max !== undefined) params.set("max", p.max);
  if (p.inStock) params.set("in_stock", "1");
  if (p.sort !== "featured") params.set("sort", p.sort);
  if (p.page > 1) params.set("page", String(p.page));
  const search = params.toString();
  return search === "" ? "" : `?${search}`;
}
