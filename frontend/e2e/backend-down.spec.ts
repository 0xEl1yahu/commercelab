import { expect, test } from "@playwright/test";

// Runs against a Next server whose API_URL points at nothing (the backend-down project).

const ORDER_PATH = `/orders/${"0".repeat(32)}`;
const HEADING = "We can't load the shop right now.";

test("home shows the friendly error page when the API is unreachable", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(HEADING);
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});

test("an order link shows the friendly error page, not a 404, when the API is unreachable", async ({ page }) => {
  await page.goto(ORDER_PATH);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(HEADING);
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  // The shell around it still works.
  await expect(page.getByRole("contentinfo")).toBeVisible();
  await expect(page.getByText(/ECONNREFUSED|fetch failed/i)).toHaveCount(0);
});

test("Try again asks the shop again and stays friendly while it is down", async ({ page }) => {
  await page.goto(ORDER_PATH);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(HEADING);
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});

test("the content pages still open without the backend", async ({ page }) => {
  await page.goto("/contact");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Contact");
});
