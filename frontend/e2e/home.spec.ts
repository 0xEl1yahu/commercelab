import { expect, test } from "@playwright/test";

import type { CollectionDetail } from "../lib/types";

import { apiUrl, catalogueIds, resetDatabase } from "./support";

test.beforeAll(() => {
  resetDatabase();
});

test("hero shows the spotlight product with tagline and links to it", async ({ page, request }) => {
  const { spotlight } = await catalogueIds(request);
  await page.goto("/");
  const hero = page.getByRole("region", { name: "Quill Low Profile Wireless Keyboard" });
  await expect(hero.getByRole("heading", { level: 1 })).toHaveText(
    "Quill Low Profile Wireless Keyboard",
  );
  await expect(hero).toContainText("Quiet keys. Three devices. One cable.");
  await expect(hero).toContainText("New from Halden");

  const buy = hero.getByRole("link", { name: "Buy · £119.00" });
  await expect(buy).toHaveAttribute("href", `/p/${spotlight.slug}`);
  const learnMore = hero.getByRole("link", { name: /^Learn more/ });
  await expect(learnMore).toHaveAttribute("href", `/p/${spotlight.slug}`);
  await expect(hero.getByTestId("product-image")).toHaveCount(1);
});

test("featured shows 8 tiles each with name, price and stock label", async ({ page }) => {
  await page.goto("/");
  const featured = page.getByRole("region", { name: "Featured" });
  const tiles = featured.getByTestId("product-tile");
  await expect(tiles).toHaveCount(8);
  for (const tile of await tiles.all()) {
    await expect(tile.getByRole("heading")).not.toBeEmpty();
    await expect(tile).toContainText(/£\d[\d,]*\.\d{2}/);
    await expect(tile.getByTestId("stock-badge")).toHaveText(/^(In stock|Only \d+ left|Out of stock)$/);
    await expect(tile).toHaveAttribute("href", /^\/p\/[a-z0-9-]+$/);
  }
});

test("limited product tile in featured says Only 2 left", async ({ page, request }) => {
  const { limited } = await catalogueIds(request);
  await page.goto("/");
  const tile = page
    .getByRole("region", { name: "Featured" })
    .locator(`[data-testid="product-tile"][href="/p/${limited.slug}"]`);
  await expect(tile.getByTestId("stock-badge")).toHaveText("Only 2 left");
});

test("the quiet desk shows its description and first three products", async ({ page, request }) => {
  const res = await request.get(apiUrl("/collections/quiet-desk"));
  const collection = (await res.json()) as CollectionDetail;
  await page.goto("/");
  const section = page.getByRole("region", { name: "The quiet desk" });
  await expect(section).toContainText(collection.description);
  const tiles = section.getByTestId("product-tile");
  await expect(tiles).toHaveCount(3);
  for (const [i, product] of collection.products.slice(0, 3).entries()) {
    await expect(tiles.nth(i)).toHaveAttribute("href", `/p/${product.slug}`);
  }
});

test("category strip links to all six categories", async ({ page }) => {
  await page.goto("/");
  const strip = page.getByRole("region", { name: "Shop by category" });
  const links = strip.getByRole("link");
  await expect(links).toHaveCount(6);
  const expected = [
    ["Keyboards", "/c/keyboards", "Low-profile, mechanical and compact."],
    ["Mice", "/c/mice", "Quiet, ergonomic and precise."],
    ["Monitors", "/c/monitors", "Sharp screens and the arms to hold them."],
    ["Audio", "/c/audio", "Headsets, speakers and microphones for calls."],
    ["Desk", "/c/desk", "Lamps, stands, mats and webcams."],
    ["Cables & docks", "/c/cables", "Docks, hubs and the cables between them."],
  ] as const;
  for (const [i, [title, href, description]] of expected.entries()) {
    await expect(links.nth(i)).toHaveAttribute("href", href);
    await expect(links.nth(i)).toContainText(title);
    await expect(links.nth(i)).toContainText(description);
  }
});

test("missing image falls back to a surface tile", async ({ page }) => {
  await page.route("**/media/**", (route) => route.fulfill({ status: 404 }));
  await page.goto("/");
  await expect(page.locator('[data-fallback="true"]').first()).toBeVisible();
  // Every product frame on the page falls back; none shows a broken image.
  const frames = page.getByTestId("product-image");
  await expect(page.locator('[data-fallback="true"]')).toHaveCount(await frames.count());
  await expect(page.locator('[data-testid="product-image"] img')).toHaveCount(0);
});

test("no fallback tiles when images load", async ({ page, request }) => {
  const res = await request.get(apiUrl("/collections/featured"));
  const featured = (await res.json()) as CollectionDetail;
  test.skip(
    featured.products.some((p) => p.image === null),
    "a featured product has no image (B2 not merged)",
  );
  await page.goto("/");
  const images = page.locator('[data-testid="product-image"] img');
  await expect(images.first()).toBeVisible();
  // Wait for every photo to finish loading before counting fallbacks.
  await expect
    .poll(() => images.evaluateAll((els) => els.every((el) => (el as HTMLImageElement).complete)))
    .toBe(true);
  await expect(page.locator('[data-fallback="true"]')).toHaveCount(0);
});

test("mobile shows two tiles per row and no horizontal scroll", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/");
  const tiles = page.getByRole("region", { name: "Featured" }).getByTestId("product-tile");
  const [a, b, c] = await Promise.all([0, 1, 2].map((i) => tiles.nth(i).boundingBox()));
  expect(a!.y).toBe(b!.y);
  expect(c!.y).toBeGreaterThan(a!.y);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
});
