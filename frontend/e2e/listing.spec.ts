import { expect, test, type Page } from "@playwright/test";

import { resetDatabase } from "./support";

// The seeded keyboards: nine active products, three each from Halden, Marlow and
// Tessel, and one of them (Marlow's Slim 2) sold out.
const SOLD_OUT_KEYBOARD = "Slim 2 Wireless Keyboard";

test.beforeAll(() => {
  resetDatabase();
});

const tiles = (page: Page) => page.getByTestId("product-tile");
const count = (page: Page) => page.getByTestId("result-count");

async function tilePrices(page: Page): Promise<number[]> {
  const texts = await tiles(page).evaluateAll((els) =>
    els.map((el) => el.querySelector("span.tabular-nums")?.textContent ?? ""),
  );
  return texts.map((t) => Number(t.replace(/[£,]/g, "")));
}

test("keyboards shows 9 results, 8 on page 1 and 1 on page 2", async ({ page }) => {
  await page.goto("/c/keyboards");
  await expect(page.getByRole("heading", { level: 1, name: "Keyboards" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Home›Keyboards");
  await expect(page.getByText("Free delivery on every order.")).toBeVisible();
  await expect(count(page)).toHaveText("9 results");
  await expect(tiles(page)).toHaveCount(8);
  await expect(page.getByText("Showing 1–8 of 9")).toBeVisible();

  const pager = page.getByRole("navigation", { name: "Pages" });
  await expect(pager.getByRole("link", { name: "Page 1" })).toHaveAttribute("aria-current", "page");
  await pager.getByRole("link", { name: "Page 2" }).click();

  await expect(page).toHaveURL(/\/c\/keyboards\?page=2$/);
  await expect(tiles(page)).toHaveCount(1);
  await expect(page.getByText("Showing 9–9 of 9")).toBeVisible();
  await expect(pager.getByRole("link", { name: "Page 2" })).toHaveAttribute("aria-current", "page");
  await expect(count(page)).toHaveText("9 results");
});

test("brand filter narrows results and adds a removable pill", async ({ page }) => {
  await page.goto("/c/keyboards");
  await page.getByRole("button", { name: "Brand" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Halden" }).click();

  await expect(page).toHaveURL(/brand=Halden/);
  await expect(count(page)).toHaveText("3 results");
  await expect(tiles(page)).toHaveCount(3);
  for (const text of await tiles(page).allInnerTexts()) expect(text).toContain("Halden");
  await expect(page.getByText("Showing 1–3 of 3")).toBeVisible();

  // A second brand adds to the first (the menu stays open for it).
  await page.getByRole("menuitemcheckbox", { name: "Tessel" }).click();
  await expect(count(page)).toHaveText("6 results");
  await page.keyboard.press("Escape");

  const pill = page.getByRole("link", { name: "Remove Halden filter" });
  await expect(pill).toBeVisible();
  await expect(page.getByRole("link", { name: "Remove Tessel filter" })).toBeVisible();

  await pill.click();
  await expect(count(page)).toHaveText("3 results");
  await expect(page).toHaveURL(/brand=Tessel/);
  await expect(page).not.toHaveURL(/brand=Halden/);
  await expect(pill).toHaveCount(0);

  await page.getByRole("link", { name: "Remove Tessel filter" }).click();
  await expect(count(page)).toHaveText("9 results");
  await expect(page).toHaveURL(/\/c\/keyboards$/);
});

test("a filter change goes back to page 1", async ({ page }) => {
  await page.goto("/c/keyboards?page=2");
  await expect(tiles(page)).toHaveCount(1);
  await page.getByRole("button", { name: "Brand" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Marlow" }).click();
  await expect(count(page)).toHaveText("3 results");
  await expect(tiles(page)).toHaveCount(3);
  await expect(page).not.toHaveURL(/page=/);
});

test("in stock only hides the sold-out keyboard", async ({ page }) => {
  await page.goto("/c/keyboards?sort=name");
  await expect(page.getByRole("link", { name: new RegExp(SOLD_OUT_KEYBOARD) })).toBeVisible();
  await expect(page.getByText("Out of stock")).toHaveCount(1);

  await page.getByRole("switch", { name: "In stock only" }).click();

  await expect(page).toHaveURL(/in_stock=1/);
  await expect(count(page)).toHaveText("8 results");
  await expect(page.getByRole("link", { name: new RegExp(SOLD_OUT_KEYBOARD) })).toHaveCount(0);
  await expect(page.getByText("Out of stock")).toHaveCount(0);
  await expect(page.getByRole("switch", { name: "In stock only" })).toBeChecked();

  await page.getByRole("switch", { name: "In stock only" }).click();
  await expect(count(page)).toHaveText("9 results");
  await expect(page).toHaveURL(/\/c\/keyboards\?sort=name$/);
});

test("sorting by price low to high orders the tiles", async ({ page }) => {
  await page.goto("/c/keyboards");
  await page.getByRole("button", { name: /^Sort/ }).click();
  await page.getByRole("menuitemradio", { name: "Price: low to high" }).click();
  await expect(page).toHaveURL(/sort=price_asc/);
  await expect(page.getByRole("button", { name: /^Sort/ })).toContainText("Price: low to high");

  await expect.poll(async () => (await tilePrices(page)).length).toBe(8);
  const asc = await tilePrices(page);
  expect(asc).toEqual([...asc].sort((a, b) => a - b));

  await page.getByRole("button", { name: /^Sort/ }).click();
  await page.getByRole("menuitemradio", { name: "Price: high to low" }).click();
  await expect(page).toHaveURL(/sort=price_desc/);
  await expect.poll(async () => (await tilePrices(page))[0]).not.toBe(asc[0]);
  const desc = await tilePrices(page);
  expect(desc).toEqual([...desc].sort((a, b) => b - a));
  // The dearest of all nine leads the descending list.
  expect(desc[0]).toBeGreaterThanOrEqual(asc[asc.length - 1]);
});

test("the price popover filters by a range and shows it as a pill", async ({ page }) => {
  await page.goto("/c/keyboards");
  const all = await tilePrices(page);

  await page.getByRole("button", { name: "Price" }).click();
  await expect(page.getByRole("dialog", { name: "Price range" })).toBeVisible();
  const thumbs = page.getByRole("slider");
  await expect(thumbs).toHaveCount(2);
  // The thumbs say which is which, and read their value in pounds.
  await expect(page.getByRole("slider", { name: "Minimum price" })).toHaveAttribute(
    "aria-valuetext",
    /^£\d+$/,
  );
  await expect(page.getByRole("slider", { name: "Maximum price" })).toHaveAttribute(
    "aria-valuetext",
    /^£\d+$/,
  );
  // Raise the lower bound with the keyboard; the change applies when the thumb is released.
  await thumbs.first().focus();
  for (let i = 0; i < 40; i += 1) await page.keyboard.press("ArrowRight");

  await expect(page).toHaveURL(/min=\d+/);
  const floor = Number(new URL(page.url()).searchParams.get("min"));
  await expect(page.getByRole("slider", { name: "Minimum price" })).toHaveAttribute(
    "aria-valuetext",
    `£${floor}`,
  );
  await page.keyboard.press("Escape");
  // Closing the popover hands focus back to its trigger.
  await expect(page.getByRole("button", { name: "Price" })).toBeFocused();

  await expect(page.getByRole("link", { name: /^Remove price filter/ })).toBeVisible();
  const filtered = await tilePrices(page);
  expect(filtered.length).toBeGreaterThan(0);
  expect(filtered.length).toBeLessThan(all.length);
  for (const price of filtered) expect(price).toBeGreaterThanOrEqual(floor);

  await page.getByRole("link", { name: /^Remove price filter/ }).click();
  await expect(page).toHaveURL(/\/c\/keyboards$/);
  await expect(count(page)).toHaveText("9 results");
});

test("a change made while the price slider settles is kept", async ({ page }) => {
  await page.goto("/c/keyboards");
  await page.getByRole("button", { name: "Price" }).click();
  await page.getByRole("slider", { name: "Minimum price" }).focus();
  for (let i = 0; i < 20; i += 1) await page.keyboard.press("ArrowRight");
  // Straight away, inside the settle window: switch on "In stock only".
  await page.getByRole("switch", { name: "In stock only" }).click();

  await expect(page).toHaveURL(/in_stock=1/);
  await expect(page).toHaveURL(/min=\d+/);
  await expect(page.getByRole("switch", { name: "In stock only" })).toBeChecked();
});

test("a shared filtered URL opens already filtered, and back undoes a filter", async ({ page }) => {
  await page.goto("/c/keyboards?brand=Halden&brand=Tessel&in_stock=1&sort=price_desc");
  await expect(count(page)).toHaveText("6 results");
  await expect(page.getByRole("switch", { name: "In stock only" })).toBeChecked();
  await expect(page.getByRole("button", { name: /^Sort/ })).toContainText("Price: high to low");
  await expect(page.getByRole("link", { name: "Remove Halden filter" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Remove Tessel filter" })).toBeVisible();

  await page.goto("/c/keyboards");
  await page.getByRole("switch", { name: "In stock only" }).click();
  await expect(count(page)).toHaveText("8 results");
  await page.goBack();
  await expect(count(page)).toHaveText("9 results");
  await expect(page.getByRole("switch", { name: "In stock only" })).not.toBeChecked();
});

test("page 99 shows an empty state with a link to page 1", async ({ page }) => {
  const res = await page.goto("/c/keyboards?page=99");
  expect(res?.status()).toBe(200);
  await expect(page.getByText("Nothing on this page.")).toBeVisible();
  await expect(tiles(page)).toHaveCount(0);
  await expect(count(page)).toHaveText("9 results");
  await page.getByRole("link", { name: "Go to page 1" }).click();
  await expect(page).toHaveURL(/\/c\/keyboards$/);
  await expect(tiles(page)).toHaveCount(8);
});

test("a filter with no matches says so and offers to clear it", async ({ page }) => {
  await page.goto("/c/keyboards?brand=Nobody");
  await expect(count(page)).toHaveText("0 results");
  await expect(page.getByText("No products match these filters.")).toBeVisible();
  await page.getByRole("link", { name: "Clear filters" }).first().click();
  await expect(count(page)).toHaveText("9 results");
});

test("unknown category shows the 404 page", async ({ page }) => {
  const res = await page.goto("/c/not-a-category");
  expect(res?.status()).toBe(404);
  await expect(tiles(page)).toHaveCount(0);
  await expect(page.getByText(/something went wrong/i)).toHaveCount(0);
});

test("reversed and malformed price params still render", async ({ page }) => {
  // Reversed: swapped, so it means £50 to £200.
  const reversed = await page.goto("/c/keyboards?min=200&max=50");
  expect(reversed?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "Keyboards" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Remove price filter: £50 to £200" })).toBeVisible();
  for (const price of await tilePrices(page)) {
    expect(price).toBeGreaterThanOrEqual(50);
    expect(price).toBeLessThanOrEqual(200);
  }

  // Malformed: ignored, so nothing is filtered.
  for (const query of [
    "?min=Infinity",
    "?min=1e3",
    "?max=-5",
    "?min=abc&max=%20",
    "?sort=nonsense",
    "?page=0",
    "?page=abc",
  ]) {
    const res = await page.goto(`/c/keyboards${query}`);
    expect(res?.status(), query).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: "Keyboards" }), query).toBeVisible();
    await expect(page.getByText(/something went wrong/i), query).toHaveCount(0);
    await expect(tiles(page).first(), query).toBeVisible();
  }
  // A huge but well-formed price is a real filter that matches nothing: an empty state, not an error.
  const huge = await page.goto("/c/keyboards?min=99999999999999999999999999");
  expect(huge?.status()).toBe(200);
  await expect(page.getByText("No products match these filters.")).toBeVisible();

  await page.goto("/c/keyboards?min=Infinity");
  await expect(count(page)).toHaveText("9 results");
  await expect(page.getByRole("link", { name: /^Remove price filter/ })).toHaveCount(0);
});

test("on a phone the grid is two across and the page does not scroll sideways", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/c/keyboards?brand=Halden&brand=Marlow&in_stock=1");
  await expect(tiles(page).first()).toBeVisible();
  const boxes = await tiles(page).evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { left: Math.round(r.left), top: Math.round(r.top) };
    }),
  );
  const firstRow = boxes.filter((b) => b.top === boxes[0].top);
  expect(firstRow).toHaveLength(2);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await expect(page.getByRole("button", { name: "Brand" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Sort/ })).toBeVisible();
  await expect(count(page)).toBeVisible();
});
