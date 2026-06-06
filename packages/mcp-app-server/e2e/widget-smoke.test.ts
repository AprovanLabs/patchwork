/**
 * Widget visual smoke test.
 *
 * Compiles a minimal widget in Node, spins up a temporary HTTP server to
 * serve the resulting HTML, then drives a headless Chromium browser to
 * verify the widget renders and captures a screenshot.
 *
 * This test is intentionally self-contained — it does not depend on the
 * running MCP / widget server so it can be executed without any external
 * processes.  Tests that validate the full widget-server pipeline (URL
 * routing, live updates, etc.) should live in separate test files and use
 * the `baseURL` / `webServer` Playwright config.
 */

import { test, expect } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { mkdir } from "node:fs/promises";
import { compileWidget } from "../src/compiler/compile.js";
import type { Manifest } from "@aprovan/patchwork-compiler";

// ---------------------------------------------------------------------------
// Fixture: a simple widget to compile
// ---------------------------------------------------------------------------

const SIMPLE_WIDGET_SOURCE = `
export default function Widget() {
  return (
    <div
      id="widget-content"
      style={{ padding: "1.5rem", background: "#dbeafe", borderRadius: "8px" }}
    >
      <h1 style={{ margin: 0, fontSize: "1.25rem" }}>Hello from Patchwork</h1>
      <p style={{ margin: "0.5rem 0 0" }}>Widget rendered successfully.</p>
    </div>
  );
}
`;

const TEST_MANIFEST: Manifest = {
  name: "smoke-test",
  version: "0.1.0",
  platform: "browser",
  image: "@aprovan/patchwork-image-shadcn",
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe("widget smoke", () => {
  let httpServer: Server;
  let widgetUrl: string;

  test.beforeAll(async () => {
    // Ensure screenshot output directory exists
    await mkdir(".artifacts/screenshots", { recursive: true });

    // Compile the widget in Node (this is the CPU/I/O-heavy step)
    const result = await compileWidget(SIMPLE_WIDGET_SOURCE, TEST_MANIFEST);

    // Spin up a minimal HTTP server that serves the compiled HTML
    httpServer = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(result.html);
    });

    await new Promise<void>((resolve) =>
      httpServer.listen(0, "127.0.0.1", resolve)
    );

    const addr = httpServer.address() as { address: string; port: number };
    widgetUrl = `http://127.0.0.1:${addr.port}/`;
  }, 120_000 /* compile can take a while on a cold cache */);

  test.afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      httpServer.close((err) => (err ? reject(err) : resolve()))
    );
  });

  test("compiled widget renders in browser", async ({ page }) => {
    await page.goto(widgetUrl);

    // The compiled bundle mounts React into #root
    await expect(page.locator("#root")).toBeVisible({ timeout: 15_000 });

    // Our widget's inner element should also be visible
    await expect(page.locator("#widget-content")).toBeVisible();

    // Capture a screenshot into .artifacts/screenshots/
    await page.screenshot({
      path: ".artifacts/screenshots/widget-smoke.png",
      fullPage: true,
    });
  });
});
