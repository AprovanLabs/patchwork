/**
 * Widget visual smoke test.
 *
 * Saves a minimal widget's RAW source to an isolated store, serves the shared
 * browser runtime + raw files over HTTP, then drives a headless Chromium browser
 * to verify the runtime compiles and mounts the widget in-browser.
 *
 * This exercises the same path as production: no server-side compilation — the
 * runtime fetches raw files and compiles them with @aprovan/patchwork-compiler.
 *
 * NOTE: dist/runtime must be built first (`pnpm build:runtime`).
 */

import { test, expect } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import { WidgetStore } from "../src/widget-store/store.js";
import type { Manifest, VirtualFile } from "@aprovan/patchwork-compiler";

const RUNTIME_DIR = fileURLToPath(new URL("../dist/runtime", import.meta.url));

const SIMPLE_WIDGET_FILES: VirtualFile[] = [
  {
    path: "main.tsx",
    content: `
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
`,
  },
];

const TEST_MANIFEST: Manifest = {
  name: "smoke-test",
  version: "0.1.0",
  platform: "browser",
  image: "@aprovan/patchwork-image-shadcn",
};

test.describe("widget smoke", () => {
  let httpServer: Server;
  let widgetUrl: string;

  test.beforeAll(async () => {
    await mkdir(".artifacts/screenshots", { recursive: true });

    if (!existsSync(RUNTIME_DIR)) {
      throw new Error(`Runtime bundle missing at ${RUNTIME_DIR}. Run \`pnpm build:runtime\`.`);
    }

    const storeDir = await mkdtemp(join(tmpdir(), "pw-smoke-"));
    const store = new WidgetStore({ storageDir: storeDir });
    const hash = "smoke";
    await store.saveWidget(hash, SIMPLE_WIDGET_FILES, TEST_MANIFEST, "main.tsx");

    const app = express();
    app.use(cors());
    app.use("/runtime", express.static(RUNTIME_DIR));
    app.get("/widget/:name/:hash/files", async (req, res) => {
      const widget = await store.getWidget(req.params.name, req.params.hash);
      if (!widget) {
        res.status(404).json({ error: "not found" });
        return;
      }
      res.json({ files: widget.files, entry: widget.entry, manifest: widget.manifest });
    });

    httpServer = createServer(app);
    await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));

    const addr = httpServer.address() as { address: string; port: number };
    widgetUrl = `http://127.0.0.1:${addr.port}/runtime/?widget=${TEST_MANIFEST.name}/${hash}`;
  }, 120_000);

  test.afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      httpServer.close((err) => (err ? reject(err) : resolve()))
    );
  });

  test("widget compiles and renders in browser", async ({ page }) => {
    await page.goto(widgetUrl);

    // The runtime mounts the compiled widget into #root
    await expect(page.locator("#root > *")).toBeVisible({ timeout: 90_000 });

    // Our widget's inner element should also be visible
    await expect(page.locator("#widget-content")).toBeVisible();

    await page.screenshot({
      path: ".artifacts/screenshots/widget-smoke.png",
      fullPage: true,
    });
  });
});
