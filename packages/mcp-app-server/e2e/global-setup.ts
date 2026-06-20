/**
 * Playwright global setup for visual regression tests.
 *
 * Responsibilities:
 * 1. Save the live-dashboard reference widget's RAW source files to an isolated
 *    widget store (no server-side compilation).
 * 2. Start an in-process Express widget server on WIDGET_PORT (default 3002) that
 *    serves the shared browser runtime (dist/runtime) plus each widget's raw
 *    files at /widget/:name/:hash/files.
 * 3. Write a test-fixtures.json file so tests can discover widget runtime URLs.
 *
 * Compilation now happens in the browser via @aprovan/patchwork-compiler — the
 * same path the chat app uses — so the React UMD injection hack is gone. The
 * widget's React is preloaded from the CDN by the image at mount time.
 *
 * NOTE: dist/runtime must be built first (`pnpm build:runtime`); the e2e:visual
 * script does this before invoking Playwright.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import {
  REFERENCE_WIDGET_FILES,
  REFERENCE_WIDGET_MANIFEST,
} from "../src/reference-widgets/live-dashboard.js";
import { WidgetStore } from "../src/widget-store/store.js";

const WIDGET_PORT = Number(process.env["WIDGET_PORT"] ?? 3002);
const ARTIFACTS_DIR = join(process.cwd(), ".artifacts");
const STORE_DIR = join(ARTIFACTS_DIR, "widget-store-e2e");
const FIXTURES_PATH = join(ARTIFACTS_DIR, "test-fixtures.json");
const SCREENSHOTS_DIR = join(ARTIFACTS_DIR, "screenshots");

const RUNTIME_DIR = fileURLToPath(new URL("../dist/runtime", import.meta.url));

export interface WidgetFixture {
  name: string;
  hash: string;
  url: string;
}

export interface TestFixtures {
  widgets: Record<string, WidgetFixture>;
  serverPort: number;
}

let _server: Server | null = null;

export default async function globalSetup(): Promise<void> {
  await mkdir(ARTIFACTS_DIR, { recursive: true });
  await mkdir(SCREENSHOTS_DIR, { recursive: true });
  await mkdir(STORE_DIR, { recursive: true });

  if (!existsSync(RUNTIME_DIR)) {
    throw new Error(
      `Runtime bundle not found at ${RUNTIME_DIR}. Run \`pnpm build:runtime\` before e2e tests.`,
    );
  }

  // Use an isolated store for E2E tests to avoid polluting the default store
  const store = new WidgetStore({ storageDir: STORE_DIR });

  // Save the live-dashboard reference widget as RAW source files
  const hash = "e2e-live-dashboard";
  await store.saveWidget(hash, REFERENCE_WIDGET_FILES, REFERENCE_WIDGET_MANIFEST, "main.tsx");

  const baseUrl = `http://localhost:${WIDGET_PORT}`;
  const fixtures: TestFixtures = {
    widgets: {
      "live-dashboard": {
        name: REFERENCE_WIDGET_MANIFEST.name,
        hash,
        url: `${baseUrl}/runtime/?widget=${REFERENCE_WIDGET_MANIFEST.name}/${hash}`,
      },
    },
    serverPort: WIDGET_PORT,
  };

  await writeFile(FIXTURES_PATH, JSON.stringify(fixtures, null, 2), "utf-8");

  // Start the Express widget server: shared runtime + raw widget files
  const app = express();
  app.use(cors());
  app.use("/runtime", express.static(RUNTIME_DIR));

  app.get("/widget/:name/:hash/files", async (req, res) => {
    const { name, hash: h } = req.params;
    const widget = await store.getWidget(name, h);
    if (!widget) {
      res.status(404).json({ error: "Widget not found" });
      return;
    }
    res.json({ files: widget.files, entry: widget.entry, manifest: widget.manifest });
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  await new Promise<void>((resolve) => {
    _server = createServer(app).listen(WIDGET_PORT, "127.0.0.1", () => {
      resolve();
    });
  });

  // Expose the server reference for global teardown via the module cache.
  // Playwright runs globalSetup and globalTeardown in the same Node.js process.
  (globalThis as Record<string, unknown>).__e2eWidgetServer = _server;
}
