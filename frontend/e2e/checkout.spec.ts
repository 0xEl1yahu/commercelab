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

import type { Order } from "../lib/types";
import {
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
  await page.getByLabel("Card number").fill(TEST_CUSTOMER.cardNumber);
  await page.getByLabel("Expiry date").fill(TEST_CUSTOMER.cardExpiry);
  await page.getByLabel("Security code").fill(TEST_CUSTOMER.cardSecurityCode);
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
  await seedCart(page, [{ product_id: ids.spotlight.id, quantity: 1 }]);
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
  await seedCart(page, [{ product_id: ids.spotlight.id, quantity: 1 }]);
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

test("reloading after an unanswered Pay reuses the stored key", async ({ page, request }) => {
  await seedCart(page, [{ product_id: ids.spotlight.id, quantity: 1 }]);
  const sent = recordCheckoutRequests(page);
  const before = rowCounts();

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
  await expect(page.getByTestId("checkout-message")).toContainText("Something went wrong.");

  await page.reload();
  await expect(payButton(page)).toBeEnabled();
  await fillDetails(page);
  await payButton(page).click();

  const order = await landedOnOrder(page, request);
  expect(order.status).toBe("paid");
  expect(sent).toHaveLength(2);
  expect(sent[1].key).toBe(sent[0].key);
  expect(rowCounts()).toEqual({ orders: before.orders + 1, payments: before.payments + 1 });
});

test("a declined card can be tried again with a new key", async ({ page, request }) => {
  await seedCart(page, [{ product_id: ids.spotlight.id, quantity: 1 }]);
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
  await seedCart(page, [{ product_id: ids.spotlight.id, quantity: 1 }]);
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
  await seedCart(page, [{ product_id: ids.spotlight.id, quantity: 1 }]);
  const sent = recordCheckoutRequests(page);

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
  await expect(awaiting).toContainText("Don't pay again");
  await expect(awaiting).toContainText("CL-99999");
  await expect(awaiting.getByRole("link", { name: "View your order" })).toHaveAttribute(
    "href",
    "/orders/test-token-not-real",
  );
  await expect(payButton(page)).toHaveCount(0);

  // The page re-sends on its own after 2 s.
  const order = await landedOnOrder(page, request);
  expect(order.status).toBe("paid");
  expect(sent).toHaveLength(2);
  expect(sent[1].key).toBe(sent[0].key);
  expect(sent[1].body).toBe(sent[0].body);
});

test("server validation errors show under the fields", async ({ page }) => {
  await seedCart(page, [{ product_id: ids.spotlight.id, quantity: 1 }]);
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
  await seedCart(page, [{ product_id: ids.spotlight.id, quantity: 1 }]);
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
    { product_id: ids.spotlight.id, quantity: 1 },
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
