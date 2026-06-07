/**
 * Visual regression tests for Patchwork reference widgets.
 *
 * Each test:
 * 1. Reads the pre-compiled widget URL from test-fixtures.json (written by global-setup)
 * 2. Navigates to the widget server's HTTP endpoint
 *    - The server injects React/ReactDOM UMD as blocking <script> tags so
 *      window.React is synchronously available when the module bundle evaluates
 * 3. Waits for React to mount (#root > *) and CDN resources to load (network idle)
 * 4. Captures a full-page screenshot saved to .artifacts/screenshots/<widget-name>.png
 * 5. Runs toHaveScreenshot() for visual regression baseline comparison
 */

import { readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { test, expect } from "@playwright/test";
import type { TestFixtures } from "./global-setup.js";

const ARTIFACTS_DIR = join(process.cwd(), ".artifacts");
const FIXTURES_PATH = join(ARTIFACTS_DIR, "test-fixtures.json");
const SCREENSHOTS_DIR = join(ARTIFACTS_DIR, "screenshots");

async function loadFixtures(): Promise<TestFixtures> {
  const raw = await readFile(FIXTURES_PATH, "utf-8");
  return JSON.parse(raw) as TestFixtures;
}

test.describe("Widget visual regression", () => {
  test("live-dashboard renders with Tailwind styles applied", async ({ page }) => {
    const fixtures = await loadFixtures();
    const widget = fixtures.widgets["live-dashboard"];
    if (!widget) throw new Error("live-dashboard fixture not found — check global-setup");

    // Inject a minimal window.patchwork stub before any page scripts run.
    // The live-dashboard widget calls window.patchwork.subscribe() in a
    // useEffect. In the test environment there is no MCP host, so the
    // patchwork shim cannot connect and window.patchwork is never initialised.
    // Without the stub React unmounts the tree on the thrown TypeError and
    // #root stays empty.
    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>)["patchwork"] = {
        subscribe: (_stream: string, _cb: unknown) => () => {},
        fireEvent: () => {},
        updateContext: () => {},
      };
    });

    // Collect console errors for debugging on failure
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(err.message));

    // Navigate — the server injects React UMD as blocking scripts so
    // window.React is available before the inlined module bundle evaluates
    await page.goto(widget.url, { waitUntil: "domcontentloaded" });

    // Wait for React to mount into #root
    await page.waitForSelector("#root > *", {
      timeout: 60_000,
      state: "attached",
    });

    // Wait for CDN network activity (Tailwind, any remaining esm.sh calls) to settle
    await page.waitForLoadState("networkidle", { timeout: 60_000 });

    if (consoleErrors.length > 0) {
      console.warn("Browser console errors during test:", consoleErrors);
    }

    // Verify the widget rendered its expected initial empty-state content
    await expect(page.locator("text=Waiting for live data")).toBeVisible();
    await expect(page.locator("text=Live Data Dashboard")).toBeVisible();

    // Capture a named screenshot to .artifacts/screenshots/ for artifact upload
    await mkdir(SCREENSHOTS_DIR, { recursive: true });
    const screenshotPath = join(SCREENSHOTS_DIR, "live-dashboard.png");
    await page.screenshot({ path: screenshotPath, fullPage: true });

    // Visual regression baseline — created on first run, diffed on subsequent runs
    await expect(page).toHaveScreenshot("live-dashboard.png", {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
    });
  });
});
