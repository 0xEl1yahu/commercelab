import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

// End-to-end tests drive the real backend against its own database, never a mock.
// The defaults suit a clean machine; the variables exist for when those ports or
// that database are already taken.
const API_PORT = Number(process.env.E2E_API_PORT ?? 8100);
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3100);
const DOWN_PORT = WEB_PORT + 1; // the same build, pointed at a backend that isn't there
const DATABASE_URL = process.env.E2E_DATABASE_URL ?? "postgresql://localhost/commercelab_e2e";

const REPO_ROOT = path.resolve(__dirname, "..");

const FETCH_IMAGES = "uv run python -m scripts.fetch_images";

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "en-GB",
  },
  projects: [
    {
      name: "default",
      testIgnore: /backend-down/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "backend-down",
      testMatch: /backend-down/,
      use: { ...devices["Desktop Chrome"], baseURL: `http://127.0.0.1:${DOWN_PORT}` },
    },
  ],
  // Started in this order, each waiting for the one before: the backend-down server
  // reuses the build the web server made.
  webServer: [
    {
      name: "backend",
      command: `${FETCH_IMAGES} && uv run python -m scripts.reset_db && uv run uvicorn commercelab.main:app --port ${API_PORT}`,
      cwd: REPO_ROOT,
      env: { DATABASE_URL, APP_ENV: "demo", SIMULATED_DECLINE_PERCENT: "0" },
      url: `http://127.0.0.1:${API_PORT}/health`,
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      name: "web",
      command: `npm run build && npm run start -- -p ${WEB_PORT}`,
      cwd: __dirname,
      env: { API_URL: `http://127.0.0.1:${API_PORT}` },
      url: `http://127.0.0.1:${WEB_PORT}/`,
      reuseExistingServer: false,
      timeout: 420_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      name: "backend-down",
      command: `npm run start -- -p ${DOWN_PORT}`,
      cwd: __dirname,
      // An unused unprivileged port: nothing listens, so every backend call is refused
      // at once. (Port 9 is blocked by undici as a "bad port", which never connects.)
      env: { API_URL: "http://127.0.0.1:59999" },
      // `port`, not `url`: every page on this server is an error page (500).
      port: DOWN_PORT,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
