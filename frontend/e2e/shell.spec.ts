import { expect, test } from "@playwright/test";

import type { ProductPage } from "../lib/types";

import { apiUrl, catalogueIds, resetDatabase, seedCart } from "./support";

test.beforeAll(() => {
  resetDatabase();
});

test("header lists the six categories in order", async ({ page }) => {
  await page.goto("/");
  const links = page.getByRole("navigation", { name: "Categories" }).getByRole("link");
  await expect(links).toHaveText(["Keyboards", "Mice", "Monitors", "Audio", "Desk", "Cables & docks"]);
  await expect(links.first()).toHaveAttribute("href", "/c/keyboards");
  await expect(links.last()).toHaveAttribute("href", "/c/cables");
  await expect(page.getByRole("link", { name: "CommerceLab" })).toHaveAttribute("href", "/");
  await expect(page.getByRole("button", { name: /^Bag/ })).toBeVisible();
});

test("header is exactly --header-height tall, border included", async ({ page }) => {
  for (const [width, expected] of [
    [1280, 52],
    [375, 92],
  ] as const) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    const banner = page.getByRole("banner");
    const height = await banner.evaluate((el) => el.getBoundingClientRect().height);
    const variable = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--header-height").trim(),
    );
    expect(variable).toBe(`${expected}px`);
    expect(height).toBe(expected);
  }
});

test("checkout gets the minimal header as its banner", async ({ page }) => {
  await page.goto("/checkout");
  const banner = page.getByRole("banner");
  await expect(banner).toHaveCount(1);
  await expect(banner).toContainText("Secure checkout");
  await expect(banner.getByRole("link", { name: "CommerceLab" })).toHaveAttribute("href", "/");
  await expect(page.getByRole("navigation", { name: "Categories" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Bag/ })).toHaveCount(0);
});

test("footer shows company details and content links", async ({ page }) => {
  await page.goto("/");
  const footer = page.getByRole("contentinfo");
  await expect(footer).toContainText(
    "CommerceLab Ltd · Unit 4, 21 Canal Wharf, Leeds LS11 5PS · Registered in England 15482931 · VAT GB 482 1937 55",
  );
  for (const promise of ["Free UK delivery", "30-day returns", "2-year warranty"]) {
    await expect(footer.getByText(promise, { exact: true })).toBeVisible();
  }
  const links = footer.getByRole("link");
  await expect(links).toHaveText(["Delivery & returns", "Contact", "Terms", "Privacy"]);
  for (const [name, href] of [
    ["Delivery & returns", "/delivery-returns"],
    ["Contact", "/contact"],
    ["Terms", "/terms"],
    ["Privacy", "/privacy"],
  ]) {
    await expect(footer.getByRole("link", { name, exact: true })).toHaveAttribute("href", href);
  }
});

test("media proxy serves an image with immutable caching", async ({ request }) => {
  const listing = await request.get(apiUrl("/products"), { params: { limit: 1 } });
  expect(listing.ok()).toBe(true);
  const image = ((await listing.json()) as ProductPage).items[0]?.image ?? null;
  test.skip(image === null, "no product images seeded yet (B2 not merged)");

  const res = await request.get(`/media/${image!.key}`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toMatch(/^image\//);
  expect(res.headers()["cache-control"]).toContain("immutable");
  expect(res.headers()["etag"]).toBe(`"${image!.key}"`);
});

test("media proxy passes 404 through", async ({ request }) => {
  const res = await request.get(`/media/${"0".repeat(64)}`);
  expect(res.status()).toBe(404);
});

test("media proxy passes If-None-Match through and returns the 304", async ({ request }) => {
  const key = "0".repeat(64);
  const res = await request.get(`/media/${key}`, { headers: { "If-None-Match": `"${key}"` } });
  expect(res.status()).toBe(304);
  expect(res.headers()["etag"]).toBe(`"${key}"`);
  expect(res.headers()["cache-control"]).toContain("immutable");
});

test("cart quote proxy returns the backend's answer unchanged", async ({ request }) => {
  const res = await request.post("/api/cart/quote", { data: { items: [] } });
  expect(res.status()).toBe(200);
  expect(await res.json()).toMatchObject({ lines: [], removed: [], total: "0.00" });
});

test("the bag recovers when a quote fails once", async ({ page, request }) => {
  const { spotlight } = await catalogueIds(request);
  await seedCart(page, [{ product_id: spotlight.id, quantity: 1 }]);
  let failed = 0;
  await page.route("**/api/cart/quote", async (route) => {
    if (failed === 0) {
      failed += 1;
      await route.fulfill({ status: 502, json: { detail: "upstream unavailable" } });
    } else {
      await route.continue();
    }
  });
  await page.goto("/");
  // The retry comes 1 s after the failure.
  await expect(page.getByTestId("bag-count")).toHaveText("1");
  expect(failed).toBe(1);
});

test("opening the bag asks again after every retry has failed", async ({ page, request }) => {
  test.setTimeout(45_000);
  const { spotlight } = await catalogueIds(request);
  await seedCart(page, [{ product_id: spotlight.id, quantity: 1 }]);
  let attempts = 0;
  let failing = true;
  await page.route("**/api/cart/quote", async (route) => {
    attempts += 1;
    if (failing) await route.fulfill({ status: 502, json: { detail: "upstream unavailable" } });
    else await route.continue();
  });
  await page.goto("/");
  // The first request and three retries (after 1 s, 2 s and 4 s), then it stops.
  await expect.poll(() => attempts, { timeout: 15_000 }).toBe(4);
  await page.waitForTimeout(1_500);
  expect(attempts).toBe(4);
  await expect(page.getByTestId("bag-count")).toHaveText("0");

  failing = false;
  await page.getByRole("button", { name: /^Bag/ }).click();
  await expect(page.getByTestId("bag-count")).toHaveText("1");
  expect(attempts).toBe(5);
});
