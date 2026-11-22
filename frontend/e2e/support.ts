// Shared e2e helpers. Specs drive the shop through the browser and may call the
// backend directly (apiUrl) for setup, never to assert business rules twice.

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";

import type { APIRequestContext, Page } from "@playwright/test";

import { CART_STORAGE_KEY, type CartLine } from "../lib/cart";
import type { CollectionDetail, Order, ProductCard, ProductPage } from "../lib/types";

const API_PORT = Number(process.env.E2E_API_PORT ?? 8100);
const DATABASE_URL = process.env.E2E_DATABASE_URL ?? "postgresql://localhost/commercelab_e2e";
const REPO_ROOT = path.resolve(__dirname, "..", "..");

// Copied from scripts/catalogue_data.py: the scenario products.
export const SPOTLIGHT_SKU = "HD-QUILL-GRY"; // the home page hero
export const LIMITED_SKU = "OR-H1-BLK"; // exactly 2 in stock
export const SOLD_OUT_SKU = "MR-SLIM2-WHT"; // nothing on hand

/** The shopper every checkout test uses. The card fields are typed into the form only. */
export const TEST_CUSTOMER = {
  name: "Sam Okafor",
  email: "sam.okafor@northfold.co.uk",
  phone: "07700 900412",
  company: "Northfold Studio Ltd",
  line1: "14 Albion Street",
  city: "Leeds",
  postcode: "LS1 6HX",
  cardNumber: "4242 4242 4242 4242",
  cardExpiry: "08 / 30",
  cardSecurityCode: "123",
} as const;

/** The backend's own URL, for setup calls that skip the browser. */
export function apiUrl(urlPath: string): string {
  return `http://127.0.0.1:${API_PORT}${urlPath.startsWith("/") ? urlPath : `/${urlPath}`}`;
}

/** Rebuilds the e2e database from seed 42. Call it in each spec's test.beforeAll. */
export function resetDatabase(): void {
  execFileSync("uv", ["run", "python", "-m", "scripts.reset_db"], {
    cwd: REPO_ROOT,
    env: { ...process.env, DATABASE_URL, APP_ENV: "demo" },
    stdio: "inherit",
    timeout: 120_000,
  });
}

/**
 * Puts a bag in localStorage before the page's own scripts run. Pass lines, or a raw
 * string to simulate a corrupt saved bag. It is written once per tab (the first
 * document load), so the app's own changes survive later navigations and reloads.
 * Call it before the first page.goto.
 */
export async function seedCart(page: Page, lines: CartLine[] | string): Promise<void> {
  const value = typeof lines === "string" ? lines : JSON.stringify(lines);
  await page.addInitScript(
    ({ key, value }) => {
      const marker = "commercelab.e2e.cart-seeded";
      if (window.sessionStorage.getItem(marker) !== null) return;
      window.sessionStorage.setItem(marker, "1");
      window.localStorage.setItem(key, value);
    },
    { key: CART_STORAGE_KEY, value },
  );
}

/**
 * Places a paid order straight against the backend (no browser), for tests that need
 * an existing order or someone else buying stock first. Returns the Order.
 */
export async function placeOrderViaApi(
  request: APIRequestContext,
  items: CartLine[],
  key: string = randomUUID(),
): Promise<Order> {
  const res = await request.post(apiUrl("/checkout"), {
    headers: { "Idempotency-Key": key },
    data: {
      contact: { email: TEST_CUSTOMER.email, name: TEST_CUSTOMER.name, phone: TEST_CUSTOMER.phone },
      address: {
        company: TEST_CUSTOMER.company,
        line1: TEST_CUSTOMER.line1,
        city: TEST_CUSTOMER.city,
        postcode: TEST_CUSTOMER.postcode,
        country: "GB",
      },
      items,
    },
  });
  if (res.status() !== 200 && res.status() !== 201) {
    throw new Error(`placeOrderViaApi: POST /checkout gave ${res.status()}: ${await res.text()}`);
  }
  return (await res.json()) as Order;
}

export type ProductRef = { id: number; slug: string };

/** The scenario products' ids and slugs in the current database, found by sku. */
export async function catalogueIds(
  request: APIRequestContext,
): Promise<{ spotlight: ProductRef; limited: ProductRef; soldOut: ProductRef }> {
  const spotlightRes = await request.get(apiUrl("/collections/spotlight"));
  if (!spotlightRes.ok()) throw new Error(`GET /collections/spotlight gave ${spotlightRes.status()}`);
  const spotlightCollection = (await spotlightRes.json()) as CollectionDetail;

  const productsRes = await request.get(apiUrl("/products"), { params: { limit: 100 } });
  if (!productsRes.ok()) throw new Error(`GET /products gave ${productsRes.status()}`);
  const { items } = (await productsRes.json()) as ProductPage;

  const bySku = (sku: string, from: ProductCard[]): ProductRef => {
    const product = from.find((p) => p.sku === sku);
    if (!product) throw new Error(`catalogueIds: no active product with sku ${sku}`);
    return { id: product.id, slug: product.slug };
  };

  return {
    spotlight: bySku(SPOTLIGHT_SKU, spotlightCollection.products),
    limited: bySku(LIMITED_SKU, items),
    soldOut: bySku(SOLD_OUT_SKU, items),
  };
}
