import { expect, test } from "@playwright/test";

import type { ProductPage } from "../lib/types";

import { apiUrl, resetDatabase } from "./support";

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
