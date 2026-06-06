import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration for visual widget tests.
 *
 * Run with: pnpm run e2e:visual
 *
 * Setup required before first run:
 *   npx playwright install chromium
 *
 * Tests that exercise the full widget server (route-based) require
 * the server to be running. Start it with `pnpm run dev` in a
 * separate terminal, or let Playwright's webServer block handle it
 * automatically by setting WIDGET_SERVER_AUTO=1.
 */
export default defineConfig({
  testDir: "./e2e",

  // Artifacts from failed tests land here; screenshots taken by tests go here too
  outputDir: ".artifacts/screenshots",

  // Visual regression snapshot baselines
  snapshotDir: "e2e/__snapshots__",

  // Run tests serially — widget compilation is I/O-heavy
  fullyParallel: false,

  retries: process.env["CI"] ? 1 : 0,

  use: {
    // Widget server base URL
    baseURL: "http://localhost:3002",
    headless: true,
    // Capture a screenshot on every test failure
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  /**
   * Start the widget server before running tests that hit `baseURL`.
   * Only activates when WIDGET_SERVER_AUTO=1 (e.g. on CI).
   * For local development, start the server manually with `pnpm run dev`.
   */
  ...(process.env["WIDGET_SERVER_AUTO"] === "1" && {
    webServer: {
      command: "pnpm run dev",
      url: "http://localhost:3002/health",
      reuseExistingServer: true,
      timeout: 60_000,
    },
  }),
});
