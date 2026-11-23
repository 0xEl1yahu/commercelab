import { describe, expect, test } from "vitest";

import { PAGE_SIZE, parseListingParams, toApiQuery, toSearch } from "./listing-params";

describe("parseListingParams", () => {
  test("defaults when nothing is given", () => {
    expect(parseListingParams({})).toEqual({
      brands: [],
      min: undefined,
      max: undefined,
      inStock: false,
      sort: "featured",
      page: 1,
    });
  });

  test("swaps min and max when reversed", () => {
    const p = parseListingParams({ min: "200", max: "50" });
    expect(p.min).toBe("50");
    expect(p.max).toBe("200");
  });

  test("rejects Infinity, 1e3 and negative prices", () => {
    for (const bad of ["Infinity", "1e3", "-5", "", " ", "1.234", ".5", "0x10", "NaN", "12abc"]) {
      const p = parseListingParams({ min: bad, max: bad });
      expect(p.min, `min=${JSON.stringify(bad)}`).toBeUndefined();
      expect(p.max, `max=${JSON.stringify(bad)}`).toBeUndefined();
    }
  });

  test("keeps a valid price and drops only the invalid one", () => {
    const p = parseListingParams({ min: "Infinity", max: "99.50" });
    expect(p.min).toBeUndefined();
    expect(p.max).toBe("99.50");
  });

  test("takes the first value when a price is repeated", () => {
    expect(parseListingParams({ min: ["20", "30"] }).min).toBe("20");
  });

  test("unknown sort falls back to featured", () => {
    expect(parseListingParams({ sort: "nonsense" }).sort).toBe("featured");
    expect(parseListingParams({ sort: ["price_asc", "name"] }).sort).toBe("price_asc");
    expect(parseListingParams({ sort: "price_desc" }).sort).toBe("price_desc");
  });

  test("page below 1 becomes 1", () => {
    for (const bad of ["0", "-3", "abc", "1.5", "", "1e2", "Infinity"]) {
      expect(parseListingParams({ page: bad }).page, `page=${bad}`).toBe(1);
    }
    expect(parseListingParams({ page: "3" }).page).toBe(3);
  });

  test("an absurd page number is capped, not passed on", () => {
    expect(parseListingParams({ page: "99999999999999999999" }).page).toBeLessThanOrEqual(10_000);
  });

  test("brand may repeat; blanks and duplicates are dropped", () => {
    expect(parseListingParams({ brand: ["Halden", " ", "Marlow", "Halden"] }).brands).toEqual([
      "Halden",
      "Marlow",
    ]);
    expect(parseListingParams({ brand: "Tessel" }).brands).toEqual(["Tessel"]);
  });

  test("in_stock is on only for 1 or true", () => {
    expect(parseListingParams({ in_stock: "1" }).inStock).toBe(true);
    expect(parseListingParams({ in_stock: "true" }).inStock).toBe(true);
    expect(parseListingParams({ in_stock: "0" }).inStock).toBe(false);
    expect(parseListingParams({ in_stock: "yes" }).inStock).toBe(false);
  });
});

describe("toApiQuery", () => {
  test("maps the filters onto the API's parameters", () => {
    const p = parseListingParams({
      brand: ["Halden", "Marlow"],
      min: "20",
      max: "150.50",
      in_stock: "1",
      sort: "price_asc",
      page: "2",
    });
    expect(toApiQuery("keyboards", p)).toEqual({
      category: "keyboards",
      brand: ["Halden", "Marlow"],
      min_price: "20",
      max_price: "150.50",
      in_stock: "true",
      sort: "price_asc",
      limit: String(PAGE_SIZE),
      offset: String(PAGE_SIZE),
    });
  });

  test("leaves out what is not set", () => {
    expect(toApiQuery("mice", parseListingParams({}))).toEqual({
      category: "mice",
      brand: undefined,
      min_price: undefined,
      max_price: undefined,
      in_stock: undefined,
      sort: "featured",
      limit: "8",
      offset: "0",
    });
  });
});

describe("toSearch", () => {
  test("omits defaults", () => {
    expect(toSearch(parseListingParams({}))).toBe("");
    expect(toSearch(parseListingParams({ sort: "featured", page: "1" }))).toBe("");
  });

  test("writes only what differs from the defaults", () => {
    const search = toSearch(parseListingParams({ in_stock: "1", sort: "name", page: "2" }));
    expect(new URLSearchParams(search).get("in_stock")).toBe("1");
    expect(new URLSearchParams(search).get("sort")).toBe("name");
    expect(new URLSearchParams(search).get("page")).toBe("2");
    expect(search.startsWith("?")).toBe(true);
  });

  test("round trip keeps repeated brands", () => {
    const p = parseListingParams({
      brand: ["Halden", "Corda & Co"],
      min: "10",
      max: "90",
      in_stock: "1",
      sort: "price_desc",
      page: "3",
    });
    const search = toSearch(p);
    const again = parseListingParams(searchToRecord(search));
    expect(again).toEqual(p);
    expect(new URLSearchParams(search).getAll("brand")).toEqual(["Halden", "Corda & Co"]);
  });
});

/** What Next hands a page: repeated keys become arrays. */
function searchToRecord(search: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [key, value] of new URLSearchParams(search)) {
    const prev = out[key];
    out[key] = prev === undefined ? value : Array.isArray(prev) ? [...prev, value] : [prev, value];
  }
  return out;
}
