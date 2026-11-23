import { execFileSync } from "node:child_process";

import { expect, test } from "@playwright/test";

import { formatGBP } from "../lib/money";

import { catalogueIds, placeOrderViaApi, resetDatabase, TEST_CUSTOMER } from "./support";

const DATABASE_URL = process.env.E2E_DATABASE_URL ?? "postgresql://localhost/commercelab_e2e";

/** Setup only: puts an order into a state the checkout flow can't leave it in on demand. */
function setOrderStatus(token: string, status: "pending" | "cancelled"): void {
  execFileSync(
    "psql",
    [DATABASE_URL, "-v", "ON_ERROR_STOP=1", "-c", `UPDATE orders SET status = '${status}' WHERE public_token = '${token}'`],
    { stdio: "pipe" },
  );
}

test.beforeAll(() => {
  resetDatabase();
});

test("confirmation shows reference, lines, VAT and address", async ({ page, request }) => {
  const { spotlight, limited } = await catalogueIds(request);
  const order = await placeOrderViaApi(request, [
    { product_id: spotlight.id, quantity: 2 },
    { product_id: limited.id, quantity: 1 },
  ]);
  expect(order.items).toHaveLength(2);

  await page.goto(`/orders/${order.token}`);
  const main = page.getByRole("main");

  await expect(main.getByRole("heading", { level: 1 })).toHaveText("Thank you, Sam. Your order is placed.");
  await expect(main).toContainText("Payment received.");
  await expect(main).toContainText("Keep this page's link");
  await expect(main.getByTestId("order-reference")).toHaveText(order.reference);

  for (const item of order.items) {
    const line = main.getByTestId("order-line").filter({ hasText: item.product_name });
    await expect(line).toContainText(`${item.product_name} × ${item.quantity}`);
    await expect(line).toContainText(formatGBP(item.line_total));
  }

  await expect(main.getByTestId("order-delivery")).toContainText("Free");
  await expect(main.getByTestId("order-total")).toContainText("Total paid");
  await expect(main.getByTestId("order-total")).toContainText(formatGBP(order.total));
  await expect(main.getByTestId("order-vat")).toContainText(`Includes VAT ${formatGBP(order.vat_included)}`);

  const address = main.getByTestId("order-address");
  await expect(address).toContainText("Delivering to");
  await expect(address).toContainText(TEST_CUSTOMER.name);
  await expect(address).toContainText(TEST_CUSTOMER.line1);
  await expect(address).toContainText(`${TEST_CUSTOMER.city} ${TEST_CUSTOMER.postcode}`);

  await expect(main.getByRole("link", { name: "Continue shopping" })).toHaveAttribute("href", "/");
  await expect(main.getByRole("button", { name: /pay/i })).toHaveCount(0);
});

test("confirmation fits a phone without sideways scrolling", async ({ page, request }) => {
  const { spotlight } = await catalogueIds(request);
  const order = await placeOrderViaApi(request, [{ product_id: spotlight.id, quantity: 1 }]);
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(`/orders/${order.token}`);
  await expect(page.getByTestId("order-reference")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("a pending order says we're confirming, with the reference and no Pay button", async ({ page, request }) => {
  const { spotlight } = await catalogueIds(request);
  const order = await placeOrderViaApi(request, [{ product_id: spotlight.id, quantity: 1 }]);
  setOrderStatus(order.token, "pending");

  await page.goto(`/orders/${order.token}`);
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 1 })).toHaveText("We're confirming your payment.");
  await expect(main.getByTestId("order-reference")).toHaveText(order.reference);
  await expect(main.getByRole("button")).toHaveCount(0);
  await expect(main).not.toContainText("Thank you");
});

test("a cancelled order says you weren't charged and links home", async ({ page, request }) => {
  const { spotlight } = await catalogueIds(request);
  const order = await placeOrderViaApi(request, [{ product_id: spotlight.id, quantity: 1 }]);
  setOrderStatus(order.token, "cancelled");

  await page.goto(`/orders/${order.token}`);
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 1 })).toHaveText("This order was cancelled. You weren't charged.");
  await expect(main.getByRole("link", { name: "Back to the shop" })).toHaveAttribute("href", "/");
});

test("unknown token shows the 404 page", async ({ page }) => {
  const response = await page.goto(`/orders/${"0".repeat(32)}`);
  expect(response?.status()).toBe(404);
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 1 })).toHaveText("We couldn't find that page.");
  await expect(main.getByRole("link", { name: "Home", exact: true })).toHaveAttribute("href", "/");
  const categories = main.getByRole("navigation", { name: "Shop by category" }).getByRole("link");
  await expect(categories).toHaveText(["Keyboards", "Mice", "Monitors", "Audio", "Desk", "Cables & docks"]);
  await expect(categories.first()).toHaveAttribute("href", "/c/keyboards");
});

test("an unknown path shows the same 404 page", async ({ page }) => {
  const response = await page.goto("/no-such-page");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("We couldn't find that page.");
});

test("every footer link opens a real page with a heading", async ({ page }) => {
  const titles = ["Delivery & returns", "Contact", "Terms", "Privacy"];
  for (const [i, title] of titles.entries()) {
    await page.goto("/");
    const links = page.getByRole("contentinfo").getByRole("navigation", { name: "Shop information" }).getByRole("link");
    expect(await links.count()).toBe(titles.length);
    await links.nth(i).click();
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { level: 1 })).toHaveText(title);
    expect((await main.innerText()).length).toBeGreaterThan(400);
    await expect(main).not.toContainText(/lorem ipsum/i);
  }
});

test("content pages carry the shop's promises and details", async ({ page }) => {
  await page.goto("/delivery-returns");
  let main = page.getByRole("main");
  await expect(main).toContainText("Free UK delivery");
  await expect(main).toContainText("30 days");
  await expect(main).toContainText("original packaging");
  await expect(main).toContainText("2-year warranty");

  await page.goto("/contact");
  main = page.getByRole("main");
  await expect(main).toContainText("Unit 4, 21 Canal Wharf, Leeds LS11 5PS");
  await expect(main).toContainText("Registered in England 15482931");
  await expect(main).toContainText("VAT GB 482 1937 55");
  await expect(main.getByRole("link", { name: "hello@commercelab.example" })).toHaveAttribute(
    "href",
    "mailto:hello@commercelab.example",
  );

  await page.goto("/privacy");
  main = page.getByRole("main");
  await expect(main).toContainText("never reach CommerceLab");
  await expect(main).toContainText("We record the photographer's credit and licence for each photograph.");
});

test("content pages fit a phone without sideways scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  for (const path of ["/delivery-returns", "/contact", "/terms", "/privacy", "/no-such-page"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
});
