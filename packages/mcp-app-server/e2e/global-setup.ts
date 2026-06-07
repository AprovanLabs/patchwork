/**
 * Playwright global setup for visual regression tests.
 *
 * Responsibilities:
 * 1. Download and cache React/ReactDOM UMD builds from unpkg (once per machine)
 * 2. Start an in-process Express widget server on WIDGET_PORT (default 3002)
 *    - Serves compiled widget HTML with React UMD injected as blocking <script> tags
 *    - Serves /vendor/react.js and /vendor/react-dom.js locally
 * 3. Compile the live-dashboard reference widget and save it to the widget store
 * 4. Write a test-fixtures.json file so tests can discover widget URLs by name
 *
 * Why the React injection is necessary
 * =====================================
 * vite-plugin-singlefile inlines the preload kickoff and the widget bundle into
 * a SINGLE <script type="module"> block. The preload starts an async import()
 * chain, but the widget code immediately reads window.React synchronously on
 * the very next line. On a fresh browser session the CDN import has not
 * resolved yet, so window.React is undefined and the module throws TypeError.
 *
 * Injecting React/ReactDOM as blocking UMD <script> tags (non-module, run
 * before any module script) makes window.React synchronously available before
 * the module evaluates — matching how Claude Desktop's cached browser works.
 */

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { existsSync } from "node:fs";
import cors from "cors";
import express from "express";
import { createProjectFromFiles } from "@aprovan/patchwork-compiler";
import { compileWidget } from "../src/compiler/compile.js";
import {
  REFERENCE_WIDGET_FILES,
  REFERENCE_WIDGET_MANIFEST,
} from "../src/reference-widgets/live-dashboard.js";
import { WidgetStore } from "../src/widget-store/store.js";

const WIDGET_PORT = Number(process.env["WIDGET_PORT"] ?? 3002);
const ARTIFACTS_DIR = join(process.cwd(), ".artifacts");
const VENDOR_DIR = join(ARTIFACTS_DIR, "vendor");
const STORE_DIR = join(ARTIFACTS_DIR, "widget-store-e2e");
const FIXTURES_PATH = join(ARTIFACTS_DIR, "test-fixtures.json");
const SCREENSHOTS_DIR = join(ARTIFACTS_DIR, "screenshots");

// UMD builds that provide window.React / window.ReactDOM synchronously
const REACT_UMD_URL = "https://unpkg.com/react@18/umd/react.production.min.js";
const REACT_DOM_UMD_URL = "https://unpkg.com/react-dom@18/umd/react-dom.production.min.js";
const REACT_VENDOR_PATH = join(VENDOR_DIR, "react.js");
const REACT_DOM_VENDOR_PATH = join(VENDOR_DIR, "react-dom.js");

export interface WidgetFixture {
  name: string;
  hash: string;
  url: string;
}

export interface TestFixtures {
  widgets: Record<string, WidgetFixture>;
  serverPort: number;
}

async function downloadIfMissing(url: string, destPath: string): Promise<void> {
  if (existsSync(destPath)) return;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status} ${res.statusText}`);
  const text = await res.text();
  await writeFile(destPath, text, "utf-8");
}

/**
 * Inject React and ReactDOM UMD as blocking <script> tags before the first
 * <script type="module"> in the compiled widget HTML. This ensures
 * window.React is synchronously available when the module bundle evaluates.
 *
 * We also inject a locking script immediately after the UMD tags that makes
 * window.React and window.ReactDOM non-writable. The compiled widget's
 * preload step does `window[name] = await import(cdnUrl)`, which would
 * otherwise overwrite our UMD globals with the esm.sh version, creating two
 * separate React instances. Two instances break the hooks dispatcher and cause
 * "Cannot read properties of null (reading 'useState')" at render time.
 */
function injectReactUmd(html: string, baseUrl: string): string {
  const lockScript = `<script>
(function() {
  var _React = window.React;
  var _ReactDOM = window.ReactDOM;
  Object.defineProperty(window, 'React', {
    configurable: false,
    get: function() { return _React; },
    set: function() {} // silently ignore CDN preload overwrite
  });
  Object.defineProperty(window, 'ReactDOM', {
    configurable: false,
    get: function() { return _ReactDOM; },
    set: function() {} // silently ignore CDN preload overwrite
  });
})();
</script>`;

  const injection = [
    `<script src="${baseUrl}/vendor/react.js" crossorigin></script>`,
    `<script src="${baseUrl}/vendor/react-dom.js" crossorigin></script>`,
    lockScript,
  ].join("\n");

  // Insert before the first module script (the inlined bundle)
  const moduleIdx = html.indexOf('<script type="module"');
  if (moduleIdx === -1) return html;
  return html.slice(0, moduleIdx) + injection + "\n" + html.slice(moduleIdx);
}

let _server: Server | null = null;

export default async function globalSetup(): Promise<void> {
  await mkdir(ARTIFACTS_DIR, { recursive: true });
  await mkdir(VENDOR_DIR, { recursive: true });
  await mkdir(SCREENSHOTS_DIR, { recursive: true });
  await mkdir(STORE_DIR, { recursive: true });

  // Download React UMD builds once — cached in .artifacts/vendor/
  await downloadIfMissing(REACT_UMD_URL, REACT_VENDOR_PATH);
  await downloadIfMissing(REACT_DOM_UMD_URL, REACT_DOM_VENDOR_PATH);

  const reactJs = await readFile(REACT_VENDOR_PATH, "utf-8");
  const reactDomJs = await readFile(REACT_DOM_VENDOR_PATH, "utf-8");

  // Use an isolated store for E2E tests to avoid polluting the default store
  const store = new WidgetStore({ storageDir: STORE_DIR });

  // Compile the live-dashboard reference widget
  const project = createProjectFromFiles(REFERENCE_WIDGET_FILES);
  const result = await compileWidget(project, REFERENCE_WIDGET_MANIFEST, {
    services: REFERENCE_WIDGET_MANIFEST.services,
  });

  await store.saveWidget(result.hash, result.html, REFERENCE_WIDGET_MANIFEST, "main.tsx");

  const baseUrl = `http://localhost:${WIDGET_PORT}`;
  const fixtures: TestFixtures = {
    widgets: {
      "live-dashboard": {
        name: REFERENCE_WIDGET_MANIFEST.name,
        hash: result.hash,
        url: `${baseUrl}/widget/${REFERENCE_WIDGET_MANIFEST.name}/${result.hash}`,
      },
    },
    serverPort: WIDGET_PORT,
  };

  await writeFile(FIXTURES_PATH, JSON.stringify(fixtures, null, 2), "utf-8");

  // Start the Express widget server
  const app = express();
  app.use(cors());

  // Serve React/ReactDOM UMD builds from local cache
  app.get("/vendor/react.js", (_req, res) => {
    res.setHeader("Content-Type", "application/javascript");
    res.send(reactJs);
  });
  app.get("/vendor/react-dom.js", (_req, res) => {
    res.setHeader("Content-Type", "application/javascript");
    res.send(reactDomJs);
  });

  // Serve compiled widget HTML with React UMD injected as blocking scripts
  app.get("/widget/:name/:hash", async (req, res) => {
    const { name, hash } = req.params;
    try {
      const widget = await store.getWidget(name, hash);
      if (!widget) {
        res.status(404).send("Widget not found");
        return;
      }
      const html = injectReactUmd(widget.html, baseUrl);
      res.setHeader("Content-Type", "text/html");
      res.send(html);
    } catch {
      res.status(500).send("Internal server error");
    }
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
