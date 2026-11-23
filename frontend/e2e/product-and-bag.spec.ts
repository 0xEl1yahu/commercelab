import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import type { CartQuote, ProductDetail, ProductPage } from "../lib/types";

import { apiUrl, catalogueIds, resetDatabase, seedCart } from "./support";

test.beforeAll(() => {
  resetDatabase();
});

const SPOTLIGHT_NAME = "Halden Quill Low Profile Wireless Keyboard";

/** The image's src as the browser reports it (it may be absolute). */
const mediaSrc = (key: string) => new RegExp(`/media/${key}$`);

const drawer = (page: Page) => page.getByRole("dialog", { name: "Your bag" });
const bagLines = (page: Page) => drawer(page).getByTestId("bag-line");
const checkOut = (page: Page) => drawer(page).getByRole("link", { name: "Check out" });

async function productDetail(request: APIRequestContext, slug: string): Promise<ProductDetail> {
  const res = await request.get(apiUrl(`/products/by-slug/${slug}`));
  expect(res.ok()).toBe(true);
  return (await res.json()) as ProductDetail;
}

/** A product the seed holds at least 100 of, found by asking the quote for 100 of each. */
async function plentifulProduct(request: APIRequestContext): Promise<{ id: number; slug: string }> {
  const listing = await request.get(apiUrl("/products"), { params: { limit: 100 } });
  const { items } = (await listing.json()) as ProductPage;
  const res = await request.post(apiUrl("/cart/quote"), {
    data: { items: items.map((p) => ({ product_id: p.id, quantity: 100 })) },
  });
  const quote = (await res.json()) as CartQuote;
  const line = quote.lines.find((l) => l.quantity === 100);
  if (!line) throw new Error("no seeded product has 100 or more in stock");
  return { id: line.product.id, slug: line.product.slug };
}

test.describe("product page", () => {
  test("product page shows price, VAT line, stock, breadcrumb and specs", async ({ page, request }) => {
    const { spotlight } = await catalogueIds(request);
    await page.goto(`/p/${spotlight.slug}`);

    await expect(page).toHaveTitle(`${SPOTLIGHT_NAME} — CommerceLab`);
    const buyBox = page.getByTestId("buy-box");
    await expect(buyBox.getByText("Halden", { exact: true })).toBeVisible();
    await expect(buyBox.getByRole("heading", { level: 1 })).toHaveText("Quill Low Profile Wireless Keyboard");
    await expect(buyBox.getByText("£119.00", { exact: true })).toBeVisible();
    await expect(buyBox.getByText("Includes £19.83 VAT")).toBeVisible();
    await expect(buyBox.getByTestId("stock-badge")).toHaveText("In stock");
    for (const promise of ["Free UK delivery", "30-day returns", "2-year warranty"]) {
      await expect(buyBox.getByText(promise, { exact: true })).toBeVisible();
    }

    const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(breadcrumb.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
    await expect(breadcrumb.getByRole("link", { name: "Keyboards" })).toHaveAttribute("href", "/c/keyboards");
    await expect(breadcrumb.getByText("Quill Low Profile Wireless Keyboard")).toHaveAttribute("aria-current", "page");

    await expect(page.getByRole("heading", { name: "About this" })).toBeVisible();
    await expect(page.getByText("A slim wireless keyboard with soft, quiet keys.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Specifications" })).toBeVisible();
    const layoutRow = page.getByRole("row", { name: /Layout/ });
    await expect(layoutRow.getByRole("rowheader")).toHaveText("Layout");
    await expect(layoutRow.getByRole("cell")).toHaveText("UK ISO, 75%");
  });

  test("a limited product shows its count and caps the stepper", async ({ page, request }) => {
    const { limited } = await catalogueIds(request);
    await page.goto(`/p/${limited.slug}`);
    const buyBox = page.getByTestId("buy-box");
    await expect(buyBox.getByTestId("stock-badge")).toHaveText("Only 2 left");
    await buyBox.getByRole("button", { name: "Increase quantity" }).click();
    await expect(buyBox.getByTestId("quantity")).toHaveText("2");
    await expect(buyBox.getByRole("button", { name: "Increase quantity" })).toBeDisabled();
    await buyBox.getByRole("button", { name: "Decrease quantity" }).click();
    await expect(buyBox.getByTestId("quantity")).toHaveText("1");
    await expect(buyBox.getByRole("button", { name: "Decrease quantity" })).toBeDisabled();
  });

  test("thumbnails switch the main image", async ({ page, request }) => {
    const { spotlight } = await catalogueIds(request);
    const detail = await productDetail(request, spotlight.slug);
    expect(detail.images.length).toBeGreaterThan(1);

    await page.goto(`/p/${spotlight.slug}`);
    const main = page.getByTestId("gallery-main").locator("img");
    await expect(main).toHaveAttribute("src", mediaSrc(detail.images[0].key));

    const thumbs = page.getByRole("button", { name: /^Show image \d/ });
    await expect(thumbs).toHaveCount(detail.images.length);
    await expect(thumbs.first()).toHaveAttribute("aria-pressed", "true");

    await thumbs.nth(1).click();
    await expect(main).toHaveAttribute("src", mediaSrc(detail.images[1].key));
    await expect(main).toHaveAttribute("alt", detail.images[1].alt);
    await expect(thumbs.nth(1)).toHaveAttribute("aria-pressed", "true");
    await expect(thumbs.first()).toHaveAttribute("aria-pressed", "false");
  });

  test("a failed photo shows the surface tile, not a broken image", async ({ page, request }) => {
    const { spotlight } = await catalogueIds(request);
    await page.route("**/media/**", (route) => route.fulfill({ status: 404 }));
    await page.goto(`/p/${spotlight.slug}`);
    await expect(page.getByTestId("gallery-main").locator('[data-fallback="true"]')).toBeVisible();
  });

  test("the buy box stays in view while the page scrolls", async ({ page, request }) => {
    const { spotlight } = await catalogueIds(request);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(`/p/${spotlight.slug}`);
    const buyBox = page.getByTestId("buy-box");
    await page.mouse.wheel(0, 300);
    await expect
      .poll(async () => (await buyBox.boundingBox())?.y ?? -1, { timeout: 5_000 })
      .toBeCloseTo(52 + 16, 0); // header height + 16px
  });

  test("unknown slug gives a 404 and no buy box", async ({ page }) => {
    const response = await page.goto("/p/no-such-product");
    expect(response?.status()).toBe(404);
    await expect(page.getByTestId("buy-box")).toHaveCount(0);
  });

  test("sold-out product cannot be added", async ({ page, request }) => {
    const { soldOut } = await catalogueIds(request);
    await page.goto(`/p/${soldOut.slug}`);
    const buyBox = page.getByTestId("buy-box");
    await expect(buyBox.getByTestId("stock-badge")).toHaveText("Out of stock");
    const button = buyBox.getByRole("button", { name: "Out of stock" });
    await expect(button).toBeDisabled();
    await expect(buyBox.getByRole("button", { name: "Add to bag" })).toHaveCount(0);
    await button.click({ force: true });
    await expect(drawer(page)).toHaveCount(0);
    await expect(page.getByTestId("bag-count")).toHaveText("0");
  });

  test("the page does not scroll sideways on a phone", async ({ page, request }) => {
    const { spotlight } = await catalogueIds(request);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(`/p/${spotlight.slug}`);
    await expect(page.getByTestId("buy-box")).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);
  });
});

test.describe("bag drawer", () => {
  test("add to bag opens the drawer with the line and totals", async ({ page, request }) => {
    const { spotlight } = await catalogueIds(request);
    await page.goto(`/p/${spotlight.slug}`);
    await page.getByTestId("buy-box").getByRole("button", { name: "Add to bag" }).click();

    await expect(drawer(page)).toBeVisible();
    await expect(drawer(page).getByText(`Added ${SPOTLIGHT_NAME}`)).toBeVisible();
    await expect(bagLines(page)).toHaveCount(1);
    const line = bagLines(page).first();
    await expect(line.getByText("Quill Low Profile Wireless Keyboard")).toBeVisible();
    await expect(line.getByTestId("quantity")).toHaveText("1");
    await expect(line.getByText("£119.00")).toBeVisible();
    await expect(line.getByTestId("stock-badge")).toHaveText("In stock");

    const totals = drawer(page).getByTestId("bag-totals");
    await expect(totals.getByText("Subtotal")).toBeVisible();
    await expect(totals.getByTestId("bag-subtotal")).toHaveText("£119.00");
    await expect(totals.getByTestId("bag-delivery")).toHaveText("Free");
    await expect(totals.getByText("Includes £19.83 VAT")).toBeVisible();
    await expect(page.getByTestId("bag-count")).toHaveText("1");
    await expect(checkOut(page)).toHaveAttribute("href", "/checkout");
    await expect(checkOut(page)).toBeEnabled();
  });

  test("the chosen quantity is added and priced by the quote", async ({ page, request }) => {
    const { spotlight } = await catalogueIds(request);
    await page.goto(`/p/${spotlight.slug}`);
    const buyBox = page.getByTestId("buy-box");
    await buyBox.getByRole("button", { name: "Increase quantity" }).click();
    await buyBox.getByRole("button", { name: "Increase quantity" }).click();
    await expect(buyBox.getByTestId("quantity")).toHaveText("3");
    await buyBox.getByRole("button", { name: "Add to bag" }).click();
    await expect(bagLines(page).first().getByTestId("quantity")).toHaveText("3");
    await expect(drawer(page).getByTestId("bag-subtotal")).toHaveText("£357.00");
    await expect(page.getByTestId("bag-count")).toHaveText("3");
  });

  test("the drawer closes with Escape and with Continue shopping", async ({ page, request }) => {
    const { spotlight } = await catalogueIds(request);
    await page.goto(`/p/${spotlight.slug}`);
    await page.getByRole("button", { name: "Add to bag" }).click();
    await expect(drawer(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(drawer(page)).toHaveCount(0);

    await page.getByRole("button", { name: /^Bag/ }).click();
    await expect(drawer(page)).toBeVisible();
    await drawer(page).getByRole("button", { name: "Continue shopping" }).click();
    await expect(drawer(page)).toHaveCount(0);
  });

  test("focus returns to the button that opened the drawer", async ({ page, request }) => {
    const { spotlight } = await catalogueIds(request);
    await page.goto(`/p/${spotlight.slug}`);
    const addToBag = page.getByRole("button", { name: "Add to bag" });
    const bagButton = page.getByRole("button", { name: /^Bag/ });
    const closers: [string, () => Promise<void>][] = [
      ["Escape", () => page.keyboard.press("Escape")],
      ["the close button", () => drawer(page).getByRole("button", { name: "Close" }).click()],
      ["Continue shopping", () => drawer(page).getByRole("button", { name: "Continue shopping" }).click()],
    ];

    for (const [, close] of closers) {
      await addToBag.click();
      await expect(drawer(page)).toBeVisible();
      await close();
      await expect(drawer(page)).toHaveCount(0);
      await expect(addToBag).toBeFocused();
    }

    await bagButton.focus();
    await page.keyboard.press("Enter");
    await expect(drawer(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(drawer(page)).toHaveCount(0);
    await expect(bagButton).toBeFocused();
  });

  test("the drawer's steppers are at least 44px to tap on a phone", async ({ page, request }) => {
    const { spotlight } = await catalogueIds(request);
    await seedCart(page, [{ product_id: spotlight.id, quantity: 2 }]);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/");
    await page.getByRole("button", { name: /^Bag/ }).click();
    const line = bagLines(page).first();
    await expect(line).toBeVisible();
    for (const control of [
      line.getByRole("button", { name: /^Increase quantity/ }),
      line.getByRole("button", { name: /^Decrease quantity/ }),
      line.getByRole("button", { name: /^Remove/ }),
      drawer(page).getByRole("button", { name: "Close" }),
    ]) {
      const box = await control.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
  });

  test("a line already at 100 opens the drawer without an Added line", async ({ page, request }) => {
    const { id, slug } = await plentifulProduct(request);
    await seedCart(page, [{ product_id: id, quantity: 100 }]);
    await page.goto(`/p/${slug}`);
    await expect(page.getByTestId("bag-count")).toHaveText("100");
    await page.getByTestId("buy-box").getByRole("button", { name: "Add to bag" }).click();
    await expect(drawer(page)).toBeVisible();
    const line = bagLines(page).first();
    await expect(line.getByTestId("quantity")).toHaveText("100");
    await expect(drawer(page).getByText(/^Added /)).toHaveCount(0);
    await expect(page.getByTestId("bag-count")).toHaveText("100");
  });

  test("steppers and Remove change the bag; the totals follow the quote",async ({ page, request }) => {
    const { spotlight } = await catalogueIds(request);
    await seedCart(page, [{ product_id: spotlight.id, quantity: 1 }]);
    await page.goto("/");
    await page.getByRole("button", { name: /^Bag/ }).click();
    const line = bagLines(page).first();
    await line.getByRole("button", { name: /^Increase quantity/ }).click();
    await expect(line.getByTestId("quantity")).toHaveText("2");
    await expect(drawer(page).getByTestId("bag-subtotal")).toHaveText("£238.00");
    await line.getByRole("button", { name: /^Decrease quantity/ }).click();
    await expect(drawer(page).getByTestId("bag-subtotal")).toHaveText("£119.00");
    await line.getByRole("button", { name: /^Remove/ }).click();
    await expect(drawer(page).getByText("Your bag is empty.")).toBeVisible();
    await expect(drawer(page).getByRole("link", { name: "Continue shopping" })).toHaveAttribute("href", "/");
    await expect(page.getByTestId("bag-count")).toHaveText("0");
  });

  test("asking for 3 of the limited headset clamps to 2 and the notice stays", async ({ page, request }) => {
    const { limited } = await catalogueIds(request);
    await page.goto(`/p/${limited.slug}`);
    await page.getByTestId("buy-box").getByRole("button", { name: "Add to bag" }).click();
    const line = bagLines(page).first();
    await expect(line).toBeVisible();
    for (let i = 0; i < 3; i += 1) {
      await line.getByRole("button", { name: /^Increase quantity/ }).click();
    }
    const notice = line.getByText("Only 2 available — we've updated your bag.");
    await expect(notice).toBeVisible();
    await expect(line.getByTestId("quantity")).toHaveText("2");
    await expect(drawer(page).getByTestId("bag-subtotal")).toHaveText("£298.00");
    await page.waitForTimeout(1_000);
    await expect(notice).toBeVisible();
    await expect(line.getByTestId("quantity")).toHaveText("2");

    // Editing the line clears its notice; closing the drawer clears the rest.
    await line.getByRole("button", { name: /^Decrease quantity/ }).click();
    await expect(notice).toHaveCount(0);
  });

  test("the notice is gone when the drawer is opened again", async ({ page, request }) => {
    const { limited } = await catalogueIds(request);
    await seedCart(page, [{ product_id: limited.id, quantity: 5 }]);
    await page.goto("/");
    await expect(page.getByTestId("bag-count")).toHaveText("2");
    await page.getByRole("button", { name: /^Bag/ }).click();
    await expect(bagLines(page).first().getByText("Only 2 available — we've updated your bag.")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /^Bag/ }).click();
    await expect(bagLines(page)).toHaveCount(1);
    await expect(drawer(page).getByText(/Only 2 available/)).toHaveCount(0);
  });

  test("check out waits for the quote and the totals show they are updating", async ({ page, request }) => {
    const { spotlight } = await catalogueIds(request);
    await seedCart(page, [{ product_id: spotlight.id, quantity: 1 }]);
    await page.goto("/");
    await page.getByRole("button", { name: /^Bag/ }).click();
    await expect(checkOut(page)).toBeEnabled();

    await page.route("**/api/cart/quote", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      await route.continue();
    });
    await bagLines(page).first().getByRole("button", { name: /^Increase quantity/ }).click();
    const totals = drawer(page).getByTestId("bag-totals");
    await expect(totals).toHaveAttribute("aria-busy", "true");
    await expect(drawer(page).getByRole("button", { name: "Check out" })).toBeDisabled();
    await expect(totals).toHaveAttribute("aria-busy", "false", { timeout: 8_000 });
    await expect(drawer(page).getByTestId("bag-subtotal")).toHaveText("£238.00");
    await expect(checkOut(page)).toBeEnabled();
  });

  test("when the quote cannot be fetched the drawer says so and can try again", async ({ page, request }) => {
    test.setTimeout(60_000);
    const { spotlight } = await catalogueIds(request);
    let failing = true;
    await page.route("**/api/cart/quote", async (route) => {
      if (failing) await route.fulfill({ status: 502, json: { detail: "upstream unavailable" } });
      else await route.continue();
    });
    await page.goto(`/p/${spotlight.slug}`);
    await page.getByTestId("buy-box").getByRole("button", { name: "Add to bag" }).click();
    // The first request and three retries (1 s, 2 s, 4 s) all fail.
    await expect(drawer(page).getByText("We couldn't update your bag.")).toBeVisible({ timeout: 15_000 });
    await expect(drawer(page).getByRole("button", { name: "Check out" })).toBeDisabled();

    failing = false;
    await drawer(page).getByRole("button", { name: "Try again" }).click();
    await expect(bagLines(page)).toHaveCount(1);
    await expect(drawer(page).getByText("We couldn't update your bag.")).toHaveCount(0);
    await expect(checkOut(page)).toBeEnabled();
  });

  test("the drawer is 380px wide on a desktop and full width on a phone", async ({ page, request }) => {
    const { spotlight } = await catalogueIds(request);
    await seedCart(page, [{ product_id: spotlight.id, quantity: 1 }]);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await page.getByRole("button", { name: /^Bag/ }).click();
    await expect(bagLines(page)).toHaveCount(1);
    await expect.poll(async () => (await drawer(page).boundingBox())?.width).toBe(380);
    await page.keyboard.press("Escape");

    await page.setViewportSize({ width: 375, height: 800 });
    await page.getByRole("button", { name: /^Bag/ }).click();
    await expect.poll(async () => (await drawer(page).boundingBox())?.width).toBe(375);
  });
});

test.describe("a saved bag that cannot be trusted", () => {
  test("stale cart ids are dropped on load", async ({ page, request }) => {
    const { spotlight } = await catalogueIds(request);
    await seedCart(page, [
      { product_id: 999999, quantity: 1 },
      { product_id: spotlight.id, quantity: 1 },
    ]);
    await page.goto("/");
    await expect(page.getByTestId("bag-count")).toHaveText("1");
    await page.getByRole("button", { name: /^Bag/ }).click();
    await expect(bagLines(page)).toHaveCount(1);
    await expect(bagLines(page).first()).toContainText("Quill Low Profile Wireless Keyboard");
  });

  test("oversized cart is capped", async ({ page, request }) => {
    const { id } = await plentifulProduct(request);
    await seedCart(page, [{ product_id: id, quantity: 9999 }]);
    await page.goto("/");
    await expect(page.getByTestId("bag-count")).toHaveText("100");
    await page.getByRole("button", { name: /^Bag/ }).click();
    const line = bagLines(page).first();
    await expect(line.getByTestId("quantity")).toHaveText("100");
    await expect(line.getByRole("button", { name: /^Increase quantity/ })).toBeDisabled();
  });

  test("80 lines are cut to 50 and the badge matches the drawer", async ({ page, request }) => {
    const listing = await request.get(apiUrl("/products"), { params: { limit: 100 } });
    const { items } = (await listing.json()) as ProductPage;
    const inStock = items.filter((p) => p.stock_status !== "out_of_stock");
    expect(inStock.length).toBeGreaterThanOrEqual(50);
    const lines = [
      ...inStock.map((p) => ({ product_id: p.id, quantity: 1 })),
      ...Array.from({ length: 80 }, (_, i) => ({ product_id: 900_000 + i, quantity: 1 })),
    ].slice(0, 80);
    await seedCart(page, lines);
    await page.goto("/");
    await page.getByRole("button", { name: /^Bag/ }).click();
    // Only the first 50 lines are kept, and all of them are real products.
    await expect(bagLines(page)).toHaveCount(50);
    await expect(page.getByTestId("bag-count")).toHaveText("50");
  });

  for (const [name, raw] of [
    ["not JSON", "{not json"],
    ["the wrong shape", JSON.stringify([{ product_id: "x", quantity: "many" }, null, 7])],
  ] as const) {
    test(`corrupt localStorage (${name}) does not break the page`, async ({ page, request }) => {
      const { spotlight } = await catalogueIds(request);
      await seedCart(page, raw);
      await page.goto(`/p/${spotlight.slug}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Quill Low Profile Wireless Keyboard");
      await expect(page.getByTestId("bag-count")).toHaveText("0");
      await page.getByRole("button", { name: "Add to bag" }).click();
      await expect(bagLines(page)).toHaveCount(1);
      await expect(page.getByTestId("bag-count")).toHaveText("1");
    });
  }

  test("sold-out line blocks check out", async ({ page, request }) => {
    const { soldOut, spotlight } = await catalogueIds(request);
    await seedCart(page, [
      { product_id: spotlight.id, quantity: 1 },
      { product_id: soldOut.id, quantity: 1 },
    ]);
    await page.goto("/");
    await page.getByRole("button", { name: /^Bag/ }).click();
    await expect(bagLines(page)).toHaveCount(2);
    const soldOutLine = bagLines(page).filter({ hasText: "Slim 2 Wireless Keyboard" });
    await expect(soldOutLine.getByText("Out of stock — remove it to check out.")).toBeVisible();
    await expect(soldOutLine.getByTestId("stock-badge")).toHaveText("Out of stock");
    await expect(drawer(page).getByRole("button", { name: "Check out" })).toBeDisabled();
    await expect(drawer(page).getByRole("link", { name: "Check out" })).toHaveCount(0);

    await soldOutLine.getByRole("button", { name: /^Remove/ }).click();
    await expect(bagLines(page)).toHaveCount(1);
    await expect(checkOut(page)).toBeEnabled();
  });
});
