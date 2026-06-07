import { defineConfig, devices } from "@playwright/test";
import { join } from "node:path";

const ARTIFACTS_DIR = join(process.cwd(), ".artifacts");

/**
 * Playwright configuration for visual widget tests.
 *
 * Run with: pnpm run e2e:visual
 *
 * Setup required before first run:
 *   npx playwright install chromium
 *
 * Global setup starts an in-process Express widget server and compiles
 * reference widgets before any tests run, so no external server is needed.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  workers: 1,
  timeout: 120_000,
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  snapshotDir: join(ARTIFACTS_DIR, "snapshots"),
  outputDir: join(ARTIFACTS_DIR, "playwright"),
  reporter: [
    ["list"],
    ["html", { outputFolder: join(ARTIFACTS_DIR, "playwright-report"), open: "never" }],
  ],
  use: {
    baseURL: "http://localhost:3002",
    screenshot: "on",
    trace: "off",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
