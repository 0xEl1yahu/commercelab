// Checkout end to end, against the real backend (SIMULATED_DECLINE_PERCENT=0).
//
// What matters most here is retry safety: one order and one charge however often
// Pay is pressed, the page reloaded or the network dropped. Those tests count rows
// in the e2e database's orders and payments tables directly, so a duplicate can't
// hide behind a page that looks right.
//
// The declined and "awaiting confirmation" answers can't be produced by the simulated
// provider at 0% declines, so those tests answer the first request with page.route
// and let the next one reach the backend. The confirmation page (/orders/[token]) is
// F5's: these tests check the URL and read the order back from the API.

import { execFileSync } from "node:child_process";

import { expect, test, type Page, type Request } from "@playwright/test";

import { CART_STORAGE_KEY, type CartLine } from "../lib/cart";
import { formatGBP } from "../lib/money";
import type { Order, ProductCard, ProductPage } from "../lib/types";
import {
  LIMITED_SKU,
  SOLD_OUT_SKU,
  SPOTLIGHT_SKU,
  TEST_CUSTOMER,
  apiUrl,
  catalogueIds,
  placeOrderViaApi,
  resetDatabase,
  seedCart,
  type ProductRef,
} from "./support";

const DATABASE_URL = process.env.E2E_DATABASE_URL ?? "postgresql://localhost/commercelab_e2e";

function countRows(table: "orders" | "payments"): number {
  const out = execFileSync("psql", [DATABASE_URL, "-tAc", `SELECT count(*) FROM ${table}`], {
    encoding: "utf8",
  });
  return Number(out.trim());
}

function rowCounts() {
  return { orders: countRows("orders"), payments: countRows("payments") };
}

type Sent = { key: string | undefined; body: string | null };

/** Records every POST /api/checkout the page sends (including ones a route answers). */
function recordCheckoutRequests(page: Page): Sent[] {
  const sent: Sent[] = [];
  page.on("request", (request: Request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/checkout") {
      sent.push({ key: request.headers()["idempotency-key"], body: request.postData() });
    }
  });
  return sent;
}

function payButton(page: Page) {
  return page.getByRole("button", { name: /^Pay/ });
}

async function fillDetails(page: Page): Promise<void> {
  await page.getByLabel("Email").fill(TEST_CUSTOMER.email);
  await page.getByLabel("Full name").fill(TEST_CUSTOMER.name);
  await page.getByLabel("Phone").fill(TEST_CUSTOMER.phone);
  await page.getByLabel("Company (optional)").fill(TEST_CUSTOMER.company);
  await page.getByLabel("Address line 1").fill(TEST_CUSTOMER.line1);
  await page.getByLabel("Town or city").fill(TEST_CUSTOMER.city);
  await page.getByLabel("Postcode").fill(TEST_CUSTOMER.postcode);
  await fillCard(page);
}

async function fillCard(page: Page): Promise<void> {
  await page.getByLabel("Card number").fill(TEST_CUSTOMER.cardNumber);
  await page.getByLabel("Expiry date").fill(TEST_CUSTOMER.cardExpiry);
  await page.getByLabel("Security code").fill(TEST_CUSTOMER.cardSecurityCode);
}

const parsed = (body: string | null) => JSON.parse(body ?? "null") as unknown;

// Copied from scripts/catalogue_data.py: the low-stock products the seed never orders
// (4 and 5 on hand).
const LOW_STOCK_SKUS = { keyboard: "KS-ARC-WHT", lamp: "LM-ARC-LAMP" } as const;

type APIRequest = import("@playwright/test").APIRequestContext;

async function allProducts(request: APIRequest) {
  const res = await request.get(apiUrl("/products"), { params: { limit: 100 } });
  return ((await res.json()) as ProductPage).items;
}

async function lowStockProduct(request: APIRequest, which: keyof typeof LOW_STOCK_SKUS) {
  const sku = LOW_STOCK_SKUS[which];
  const product = (await allProducts(request)).find((p) => p.sku === sku);
  if (!product || product.stock_left == null) throw new Error(`no low-stock product ${sku}`);
  return { id: product.id, left: product.stock_left };
}

// Each test that buys something takes its own in-stock product, so one product's
// stock never runs out across the file (orders here are real and stock is real).
let freshProducts: ProductCard[] = [];
function fresh(): ProductCard {
  const product = freshProducts.shift();
  if (product === undefined) throw new Error("ran out of in-stock products for checkout tests");
  return product;
}

/** What another tab would do: write a different bag to localStorage. */
async function setBagElsewhere(page: Page, lines: CartLine[]): Promise<void> {
  await page.evaluate(
    ({ key, value }) => window.localStorage.setItem(key, value),
    { key: CART_STORAGE_KEY, value: JSON.stringify(lines) },
  );
}

/** The first POST /api/checkout reaches the backend, but its answer never reaches the page. */
async function loseFirstAnswer(page: Page): Promise<void> {
  let calls = 0;
  await page.route("**/api/checkout", async (route) => {
    calls += 1;
    if (calls === 1) {
      await route.fetch();
      await route.abort("failed");
    } else {
      await route.continue();
    }
  });
}

/** Opens the checkout with the bag already quoted, so Pay shows a total and is enabled. */
async function openCheckout(page: Page): Promise<void> {
  await page.goto("/checkout");
  await expect(payButton(page)).toBeEnabled();
  await expect(payButton(page)).toHaveText(/^Pay £\d/);
}

/** Waits for the redirect to /orders/{token} and returns that order, read from the API. */
async function landedOnOrder(page: Page, request: import("@playwright/test").APIRequestContext) {
  await page.waitForURL(/\/orders\/[^/]+$/);
  const token = new URL(page.url()).pathname.split("/").pop()!;
  const res = await request.get(apiUrl(`/orders/${token}`));
  expect(res.status()).toBe(200);
  return (await res.json()) as Order;
}

function fakeOrder(status: Order["status"]): Order {
  return {
    reference: "CL-99999",
    token: "test-token-not-real",
    status,
    payment_status: status === "cancelled" ? "failed" : "unknown",
    created_at: "2026-11-22T12:00:00Z",
    customer_name: TEST_CUSTOMER.name,
    items: [],
    subtotal: "1.00",
    delivery: "0.00",
    total: "1.00",
    vat_included: "0.17",
    address: null,
  };
}

let ids: { spotlight: ProductRef; limited: ProductRef; soldOut: ProductRef };

test.beforeAll(async ({ request }) => {
  resetDatabase();
  ids = await catalogueIds(request);
  const scenario = new Set<string>([SPOTLIGHT_SKU, LIMITED_SKU, SOLD_OUT_SKU, ...Object.values(LOW_STOCK_SKUS)]);
  freshProducts = (await allProducts(request)).filter(
    (p) => p.stock_status === "in_stock" && !scenario.has(p.sku),
  );
});

test("happy path lands on the confirmation with a CL- reference", async ({ page, request }) => {
  await seedCart(page, [{ product_id: ids.spotlight.id, quantity: 1 }]);
  const sent = recordCheckoutRequests(page);
  const before = rowCounts();

  await openCheckout(page);
  await fillDetails(page);
  await payButton(page).click();

  const order = await landedOnOrder(page, request);
  expect(order.reference).toMatch(/^CL-\d+$/);
  expect(order.status).toBe("paid");
  expect(order.items.map((item) => [item.product_id, item.quantity])).toEqual([[ids.spotlight.id, 1]]);
  expect(order.address?.company).toBe(TEST_CUSTOMER.company);

  // Card details never leave the browser.
  expect(sent).toHaveLength(1);
  const body = sent[0].body ?? "";
  expect(body).not.toContain("4242");
  expect(body).not.toContain(TEST_CUSTOMER.cardExpiry);
  expect(body).not.toMatch(/card|expiry|security|cvc/i);

  expect(rowCounts()).toEqual({ orders: before.orders + 1, payments: before.payments + 1 });
  // The bag is emptied and the attempt forgotten.
  expect(await page.evaluate(() => window.localStorage.getItem("commercelab.cart.v1"))).toBe("[]");
  expect(
    await page.evaluate(() => window.sessionStorage.getItem("commercelab.checkout-attempt.v1")),
  ).toBeNull();
});

test("double clicking Pay sends one request", async ({ page, request }) => {
  await seedCart(page, [{ product_id: fresh().id, quantity: 1 }]);
  const sent = recordCheckoutRequests(page);
  const before = rowCounts();

  await openCheckout(page);
  await fillDetails(page);
  await payButton(page).dblclick();

  const order = await landedOnOrder(page, request);
  expect(order.status).toBe("paid");
  expect(sent).toHaveLength(1);
  expect(rowCounts()).toEqual({ orders: before.orders + 1, payments: before.payments + 1 });
});

test("two submits in the same instant send one request", async ({ page, request }) => {
  // Faster than any re-render: the disabled button can't help, only the in-flight guard.
  await seedCart(page, [{ product_id: fresh().id, quantity: 1 }]);
  const sent = recordCheckoutRequests(page);
  const before = rowCounts();

  await openCheckout(page);
  await fillDetails(page);
  await page.getByRole("form", { name: "Checkout" }).evaluate((form: HTMLFormElement) => {
    form.requestSubmit();
    form.requestSubmit();
  });

  const order = await landedOnOrder(page, request);
  expect(order.status).toBe("paid");
  expect(sent).toHaveLength(1);
  expect(rowCounts()).toEqual({ orders: before.orders + 1, payments: before.payments + 1 });
});

test("someone else buying the last unit shows the stock warning and corrected total", async ({
  page,
  request,
}) => {
  await seedCart(page, [{ product_id: ids.limited.id, quantity: 2 }]);
  const sent = recordCheckoutRequests(page);

  await openCheckout(page);
  await fillDetails(page);
  await placeOrderViaApi(request, [{ product_id: ids.limited.id, quantity: 1 }]);

  await payButton(page).click();

  const warning = page.getByTestId("stock-warning");
  await expect(warning).toContainText(/^Only 1 .+ left\. Someone bought one while you were checking out\./);
  await expect(warning).toContainText("We've changed your bag to 1 — check the total and pay again.");
  const line = page.getByTestId("summary-line").filter({ has: warning });
  await expect(line.getByTestId("summary-quantity")).toHaveText("1");
  await expect(line.locator("s")).toHaveText("2");
  await expect(page.getByTestId("summary-total")).toHaveText("£149.00");
  await expect(payButton(page)).toHaveText("Pay £149.00");
  await expect(payButton(page)).toBeEnabled();

  await payButton(page).click();
  const order = await landedOnOrder(page, request);
  expect(order.status).toBe("paid");
  expect(order.total).toBe("149.00");
  // The body changed (2 -> 1), so the second attempt has its own key.
  expect(sent).toHaveLength(2);
  expect(sent[1].key).not.toBe(sent[0].key);
});

test("network failure keeps the form and the key", async ({ page, request }) => {
  await seedCart(page, [{ product_id: fresh().id, quantity: 1 }]);
  const sent = recordCheckoutRequests(page);
  const before = rowCounts();

  // The worst case: the backend takes the order, but the answer never reaches the browser.
  let calls = 0;
  await page.route("**/api/checkout", async (route) => {
    calls += 1;
    if (calls === 1) {
      await route.fetch();
      await route.abort("failed");
    } else {
      await route.continue();
    }
  });

  await openCheckout(page);
  await fillDetails(page);
  await payButton(page).click();

  await expect(page.getByTestId("checkout-message")).toContainText(
    "Something went wrong. Your order wasn't placed twice — press Pay to try again.",
  );
  await expect(page.getByTestId("checkout-message")).toBeFocused();
  // The form is kept, and locked while the outcome is uncertain.
  await expect(page.getByLabel("Email")).toHaveValue(TEST_CUSTOMER.email);
  await expect(page.getByLabel("Email")).toHaveAttribute("readonly", "");
  await expect(page.getByLabel("Postcode")).toHaveAttribute("readonly", "");
  await expect(page.getByLabel("Card number")).toHaveValue(TEST_CUSTOMER.cardNumber);

  await payButton(page).click();
  const order = await landedOnOrder(page, request);
  expect(order.status).toBe("paid");
  expect(sent).toHaveLength(2);
  expect(sent[1].key).toBe(sent[0].key);
  expect(sent[1].body).toBe(sent[0].body);
  expect(rowCounts()).toEqual({ orders: before.orders + 1, payments: before.payments + 1 });
});

test("reload after a network failure restores the locked details and re-sends the same key", async ({
  page,
  request,
}) => {
  // The bag takes all but one of a low-stock product. The first order (which the
  // browser never hears about) holds those units, so after the reload the re-quote
  // cuts the bag to the 1 left. Re-building the request from that bag would be a new
  // body, a new key and a second order; re-sending the stored one is the same order.
  const low = await lowStockProduct(request, "keyboard");
  const quantity = low.left - 1;
  expect(quantity).toBeGreaterThan(1);
  await seedCart(page, [{ product_id: low.id, quantity }]);
  const sent = recordCheckoutRequests(page);
  const before = rowCounts();
  await loseFirstAnswer(page);

  await openCheckout(page);
  await fillDetails(page);
  await payButton(page).click();
  await expect(page.getByTestId("checkout-message")).toContainText("Something went wrong.");

  await page.reload();
  // The uncertain attempt is back: the details as they were sent, locked.
  await expect(page.getByTestId("checkout-message")).toContainText(
    "Something went wrong. Your order wasn't placed twice — press Pay to try again.",
  );
  await expect(page.getByLabel("Email")).toHaveValue(TEST_CUSTOMER.email);
  await expect(page.getByLabel("Email")).toHaveAttribute("readonly", "");
  await expect(page.getByLabel("Company (optional)")).toHaveValue(TEST_CUSTOMER.company);
  await expect(page.getByLabel("Postcode")).toHaveValue(TEST_CUSTOMER.postcode);
  await expect(page.getByLabel("Postcode")).toHaveAttribute("readonly", "");
  // Today's re-quote would cut the bag to 1 (the first order holds the stock), but the
  // summary and Pay describe the request Pay will re-send: 3, with no total that
  // today's quote can't vouch for.
  const summary = page.getByTestId("order-summary");
  await expect(summary.getByRole("heading", { name: "Finishing your earlier order" })).toBeVisible();
  await expect(summary.getByTestId("summary-quantity")).toHaveText(String(quantity));
  await expect(summary).toContainText("The total is confirmed when this payment goes through.");
  await expect(summary.getByTestId("summary-total")).toHaveCount(0);

  await fillCard(page); // card details are never stored
  await expect(payButton(page)).toBeEnabled();
  await expect(payButton(page)).toHaveText("Pay");
  await payButton(page).click();

  const order = await landedOnOrder(page, request);
  expect(order.status).toBe("paid");
  expect(order.items.map((item) => [item.product_id, item.quantity])).toEqual([[low.id, quantity]]);
  expect(sent).toHaveLength(2);
  expect(sent[1].key).toBe(sent[0].key);
  expect(parsed(sent[1].body)).toEqual(parsed(sent[0].body));
  expect(rowCounts()).toEqual({ orders: before.orders + 1, payments: before.payments + 1 });
  // The bag's line (cut by this very order) is gone with it.
  expect(await page.evaluate((key) => window.localStorage.getItem(key), CART_STORAGE_KEY)).toBe("[]");
});

test("a bag emptied in another tab doesn't change the earlier order Pay finishes", async ({
  page,
  request,
}) => {
  const product = fresh();
  await seedCart(page, [{ product_id: product.id, quantity: 1 }]);
  const sent = recordCheckoutRequests(page);
  const before = rowCounts();
  await loseFirstAnswer(page);

  await openCheckout(page);
  await fillDetails(page);
  await payButton(page).click();
  await expect(page.getByTestId("checkout-message")).toContainText("Something went wrong.");

  await setBagElsewhere(page, []);
  await page.reload();

  const summary = page.getByTestId("order-summary");
  await expect(summary.getByRole("heading", { name: "Finishing your earlier order" })).toBeVisible();
  await expect(summary.getByTestId("summary-line")).toHaveCount(1);
  await expect(summary).toContainText(product.name);
  await expect(summary.getByTestId("summary-total")).toHaveText(formatGBP(product.price));
  await expect(payButton(page)).toHaveText(`Pay ${formatGBP(product.price)}`);

  await fillCard(page);
  await payButton(page).click();
  const order = await landedOnOrder(page, request);
  expect(order.items.map((item) => [item.product_id, item.quantity])).toEqual([[product.id, 1]]);
  expect(sent).toHaveLength(2);
  expect(sent[1].key).toBe(sent[0].key);
  expect(rowCounts()).toEqual({ orders: before.orders + 1, payments: before.payments + 1 });
});

test("a bag changed in another tab: Pay finishes the earlier order and keeps the new bag", async ({
  page,
  request,
}) => {
  const product = fresh();
  const lamp = await lowStockProduct(request, "lamp");
  await seedCart(page, [{ product_id: product.id, quantity: 1 }]);
  const sent = recordCheckoutRequests(page);
  const before = rowCounts();
  await loseFirstAnswer(page);

  await openCheckout(page);
  await fillDetails(page);
  await payButton(page).click();
  await expect(page.getByTestId("checkout-message")).toContainText("Something went wrong.");

  const newBag = [{ product_id: lamp.id, quantity: 1 }];
  await setBagElsewhere(page, newBag);
  await page.reload();

  // The summary shows the earlier order, not the new bag.
  const summary = page.getByTestId("order-summary");
  await expect(summary.getByRole("heading", { name: "Finishing your earlier order" })).toBeVisible();
  await expect(summary.getByTestId("summary-line")).toHaveCount(1);
  await expect(summary).toContainText(product.name);
  await expect(payButton(page)).toHaveText(`Pay ${formatGBP(product.price)}`);

  await fillCard(page);
  await payButton(page).click();
  const order = await landedOnOrder(page, request);
  expect(order.items.map((item) => [item.product_id, item.quantity])).toEqual([[product.id, 1]]);
  expect(sent).toHaveLength(2);
  expect(sent[1].key).toBe(sent[0].key);
  expect(rowCounts()).toEqual({ orders: before.orders + 1, payments: before.payments + 1 });
  // The new bag was not part of that order, so it is still there.
  const saved = await page.evaluate((key) => window.localStorage.getItem(key), CART_STORAGE_KEY);
  expect(JSON.parse(saved ?? "null")).toEqual(newBag);
});

test("start a new order unlocks the form, and the next Pay uses a new key", async ({ page, request }) => {
  await seedCart(page, [{ product_id: fresh().id, quantity: 1 }]);
  const sent = recordCheckoutRequests(page);
  const before = rowCounts();
  // This time the first request never reaches the backend at all.
  let calls = 0;
  await page.route("**/api/checkout", async (route) => {
    calls += 1;
    if (calls === 1) await route.abort("failed");
    else await route.continue();
  });

  await openCheckout(page);
  await fillDetails(page);
  await payButton(page).click();
  await expect(page.getByTestId("checkout-message")).toContainText("Something went wrong.");
  await page.reload();

  const message = page.getByTestId("checkout-message");
  await expect(message).toContainText("If your earlier payment did go through, starting again could order twice.");
  await expect(page.getByLabel("Email")).toHaveAttribute("readonly", "");
  await message.getByRole("button", { name: "Start a new order" }).click();

  await expect(page.getByTestId("checkout-message")).toHaveCount(0);
  await expect(page.getByLabel("Email")).not.toHaveAttribute("readonly", "");
  await expect(page.getByLabel("Email")).toHaveValue(TEST_CUSTOMER.email);
  await expect(page.getByLabel("Email")).toBeFocused();
  await expect(page.getByRole("heading", { name: "Your bag" })).toBeVisible();

  await fillCard(page);
  await expect(payButton(page)).toHaveText(/^Pay £\d/);
  await payButton(page).click();
  const order = await landedOnOrder(page, request);
  expect(order.status).toBe("paid");
  expect(sent).toHaveLength(2);
  expect(sent[1].key).not.toBe(sent[0].key);
  expect(rowCounts()).toEqual({ orders: before.orders + 1, payments: before.payments + 1 });
});

test("a locked order is never paid without its price: Pay waits until its quote arrives", async ({
  page,
  request,
}) => {
  test.setTimeout(60_000); // the quote's own retries take 1 + 2 + 4 s
  const product = fresh();
  await seedCart(page, [{ product_id: product.id, quantity: 1 }]);
  const sent = recordCheckoutRequests(page);
  const before = rowCounts();
  await loseFirstAnswer(page);

  await openCheckout(page);
  await fillDetails(page);
  await payButton(page).click();
  await expect(page.getByTestId("checkout-message")).toContainText("Something went wrong.");

  // From now on every quote fails, so the earlier order can't be priced.
  await page.route("**/api/cart/quote", (route) => route.abort("failed"));
  await page.reload();
  await fillCard(page);

  const hint = page.getByText("We couldn't check your bag's prices.");
  await expect(hint).toBeVisible({ timeout: 20_000 });
  await expect(payButton(page)).toBeDisabled();
  await expect(payButton(page)).toHaveText("Pay");
  await expect(page.getByTestId("order-summary").getByTestId("summary-line")).toHaveCount(0);
  // The way out stays offered.
  await expect(page.getByRole("button", { name: "Start a new order" })).toBeVisible();
  expect(sent).toHaveLength(1);

  // Quotes work again: Try again prices the earlier order, and Pay can finish it.
  await page.unroute("**/api/cart/quote");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(payButton(page)).toHaveText(`Pay ${formatGBP(product.price)}`);
  await expect(payButton(page)).toBeEnabled();
  await payButton(page).click();

  const order = await landedOnOrder(page, request);
  expect(order.items.map((item) => [item.product_id, item.quantity])).toEqual([[product.id, 1]]);
  expect(sent).toHaveLength(2);
  expect(sent[1].key).toBe(sent[0].key);
  expect(rowCounts()).toEqual({ orders: before.orders + 1, payments: before.payments + 1 });
});

test("a bag the quote cuts on load can still pay, at the cut total", async ({ page, request }) => {
  const lamp = await lowStockProduct(request, "lamp");
  await seedCart(page, [{ product_id: lamp.id, quantity: 50 }]);
  await page.goto("/checkout");

  await expect(page.getByTestId("summary-quantity")).toHaveText(String(lamp.left));
  await expect(page.getByTestId("stock-notice")).toContainText(`Only ${lamp.left} left.`);
  await expect(payButton(page)).toBeEnabled();
  const total = await page.getByTestId("summary-total").textContent();
  expect(total).toMatch(/^£\d/);
  await expect(payButton(page)).toHaveText(`Pay ${total}`);
});

test("reload during an unconfirmed payment keeps checking the same key", async ({ page, request }) => {
  await seedCart(page, [{ product_id: fresh().id, quantity: 1 }]);
  const sent = recordCheckoutRequests(page);
  const before = rowCounts();

  // The backend really places (and charges) the order, but the page is told it's pending.
  let calls = 0;
  let reference = "";
  await page.route("**/api/checkout", async (route) => {
    calls += 1;
    if (calls === 1) {
      const response = await route.fetch();
      const order = (await response.json()) as Order;
      reference = order.reference;
      await route.fulfill({ response, json: { ...order, status: "pending", payment_status: "unknown" } });
    } else {
      await route.continue();
    }
  });

  await openCheckout(page);
  await fillDetails(page);
  await payButton(page).click();
  const awaiting = page.getByTestId("awaiting-panel");
  await expect(awaiting).toContainText("We're confirming your payment.");

  await page.reload();
  // Still waiting on the same order, with no Pay button, and re-checking on its own.
  await expect(awaiting).toContainText("We're confirming your payment.");
  await expect(awaiting).toContainText(reference);
  await expect(page.getByRole("heading", { name: "We're confirming your payment." })).toBeFocused();
  await expect(payButton(page)).toHaveCount(0);

  const order = await landedOnOrder(page, request);
  expect(order.status).toBe("paid");
  expect(order.reference).toBe(reference);
  expect(sent).toHaveLength(2);
  expect(sent[1].key).toBe(sent[0].key);
  expect(parsed(sent[1].body)).toEqual(parsed(sent[0].body));
  expect(rowCounts()).toEqual({ orders: before.orders + 1, payments: before.payments + 1 });
});

test("a declined card can be tried again with a new key", async ({ page, request }) => {
  await seedCart(page, [{ product_id: fresh().id, quantity: 1 }]);
  const sent = recordCheckoutRequests(page);

  let calls = 0;
  await page.route("**/api/checkout", async (route) => {
    calls += 1;
    if (calls === 1) await route.fulfill({ status: 201, json: fakeOrder("cancelled") });
    else await route.continue();
  });

  await openCheckout(page);
  await fillDetails(page);
  await payButton(page).click();

  const declined = page.getByTestId("declined-panel");
  await expect(declined).toContainText("Your card was declined. You haven't been charged.");
  await expect(declined).toBeFocused();
  // The bag and details are kept.
  await expect(page.getByLabel("Email")).toHaveValue(TEST_CUSTOMER.email);
  await expect(page.getByLabel("Email")).not.toHaveAttribute("readonly", "");

  await declined.getByRole("button", { name: "Try again" }).click();
  const order = await landedOnOrder(page, request);
  expect(order.status).toBe("paid");
  expect(sent).toHaveLength(2);
  expect(sent[1].body).toBe(sent[0].body);
  expect(sent[1].key).not.toBe(sent[0].key);
});

test("use a different card clears and focuses the card fields", async ({ page }) => {
  await seedCart(page, [{ product_id: fresh().id, quantity: 1 }]);
  await page.route("**/api/checkout", (route) =>
    route.fulfill({ status: 201, json: fakeOrder("cancelled") }),
  );

  await openCheckout(page);
  await fillDetails(page);
  await payButton(page).click();

  const declined = page.getByTestId("declined-panel");
  await declined.getByRole("button", { name: "Use a different card" }).click();
  await expect(page.getByLabel("Card number")).toHaveValue("");
  await expect(page.getByLabel("Expiry date")).toHaveValue("");
  await expect(page.getByLabel("Security code")).toHaveValue("");
  await expect(page.getByLabel("Card number")).toBeFocused();
  await expect(page.getByLabel("Email")).toHaveValue(TEST_CUSTOMER.email);
});

test("an unconfirmed payment waits, then re-sends the same request and key", async ({
  page,
  request,
}) => {
  await seedCart(page, [{ product_id: fresh().id, quantity: 1 }]);
  const sent = recordCheckoutRequests(page);
  const before = rowCounts();

  let calls = 0;
  await page.route("**/api/checkout", async (route) => {
    calls += 1;
    if (calls === 1) await route.fulfill({ status: 201, json: fakeOrder("pending") });
    else await route.continue();
  });

  await openCheckout(page);
  await fillDetails(page);
  await payButton(page).click();

  const awaiting = page.getByTestId("awaiting-panel");
  await expect(awaiting).toContainText("We're confirming your payment.");
  await expect(page.getByRole("heading", { name: "We're confirming your payment." })).toBeFocused();
  await expect(awaiting).toContainText("Don't pay again");
  await expect(awaiting).toContainText("CL-99999");
  // An order is named, so there is "View your order", not "Start a new order".
  await expect(page.getByRole("button", { name: "Start a new order" })).toHaveCount(0);
  await expect(awaiting.getByRole("link", { name: "View your order" })).toHaveAttribute(
    "href",
    "/orders/test-token-not-real",
  );
  await expect(payButton(page)).toHaveCount(0);

  // The page re-sends on its own after 2 s. The first answer was mocked, so the order
  // is made by that re-send: exactly one.
  const order = await landedOnOrder(page, request);
  expect(order.status).toBe("paid");
  expect(sent).toHaveLength(2);
  expect(sent[1].key).toBe(sent[0].key);
  expect(sent[1].body).toBe(sent[0].body);
  expect(rowCounts()).toEqual({ orders: before.orders + 1, payments: before.payments + 1 });
});

test("server validation errors show under the fields", async ({ page }) => {
  await seedCart(page, [{ product_id: fresh().id, quantity: 1 }]);
  await page.route("**/api/checkout", (route) =>
    route.fulfill({
      status: 422,
      json: {
        detail: [
          {
            loc: ["body", "address", "postcode"],
            msg: "String should match pattern '^[A-Za-z0-9 ]{5,8}$'",
            type: "string_pattern_mismatch",
          },
        ],
      },
    }),
  );

  await openCheckout(page);
  await fillDetails(page);
  await payButton(page).click();

  await expect(page.getByTestId("checkout-message")).toContainText("Please check the highlighted fields.");
  const postcode = page.getByLabel("Postcode");
  await expect(postcode).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByTestId("postcode-error")).toHaveText("Enter a UK postcode.");
  await expect(postcode).toBeFocused();
  await expect(page.getByLabel("Email")).not.toHaveAttribute("aria-invalid", "true");
});

test("missing details are flagged before anything is sent", async ({ page }) => {
  await seedCart(page, [{ product_id: fresh().id, quantity: 1 }]);
  const sent = recordCheckoutRequests(page);

  await openCheckout(page);
  await payButton(page).click();

  await expect(page.getByTestId("email-error")).toHaveText("Enter your email address.");
  await expect(page.getByTestId("number-error")).toBeVisible();
  await expect(page.getByLabel("Email")).toBeFocused();
  expect(sent).toHaveLength(0);
});

test("a sold-out line blocks Pay until it is removed", async ({ page }) => {
  await seedCart(page, [
    { product_id: fresh().id, quantity: 1 },
    { product_id: ids.soldOut.id, quantity: 1 },
  ]);
  await page.goto("/checkout");

  const soldOutLine = page.getByTestId("summary-line").filter({ hasText: "Sold out" });
  await expect(soldOutLine).toBeVisible();
  await expect(payButton(page)).toBeDisabled();

  await soldOutLine.getByRole("button", { name: /Remove/ }).click();
  await expect(page.getByTestId("summary-line")).toHaveCount(1);
  await expect(payButton(page)).toBeEnabled();
});

test("empty bag shows the empty state", async ({ page }) => {
  await page.goto("/checkout");
  await expect(page.getByRole("heading", { name: "Your bag is empty." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Continue shopping" })).toHaveAttribute("href", "/");
  await expect(payButton(page)).toHaveCount(0);
});
