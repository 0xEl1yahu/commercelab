import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Unit tests cover pure logic only (lib/*.test.ts). Screens are tested end to end
// with Playwright against the real backend (e2e/).
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "components/**/*.test.ts"],
    exclude: ["node_modules/**", "e2e/**", ".next/**"],
  },
});
