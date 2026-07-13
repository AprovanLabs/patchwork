import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import { log, error } from "./logger.js";
import {
  REFERENCE_WIDGET_FILES,
  REFERENCE_WIDGET_MANIFEST,
} from "./reference-widgets/live-dashboard.js";
import { startTunnel, stopTunnel } from "./tunnel.js";
import { getWidgetStore, resetWidgetStore } from "./widget-store/index.js";

const WIDGET_PORT = Number(process.env["WIDGET_PORT"] ?? 3002);
const ARTIFACTS_DIR = resolve(process.cwd(), ".artifacts");
const RUNTIME_DIR = fileURLToPath(new URL("../dist/runtime", import.meta.url));

interface WidgetPreviewEntry {
  name: string;
  hash: string;
  url: string;
}

function parseArgs(): { tunnel: boolean } {
  return {
    tunnel: process.argv.includes("--tunnel"),
  };
}

async function saveReferenceWidgets(): Promise<Array<{ name: string; hash: string }>> {
  resetWidgetStore();
  const store = getWidgetStore();

  const hash = "reference";
  await store.saveWidget(hash, REFERENCE_WIDGET_FILES, REFERENCE_WIDGET_MANIFEST, "main.tsx");

  return [{ name: REFERENCE_WIDGET_MANIFEST.name, hash }];
}

async function startWidgetServer(): Promise<void> {
  if (!existsSync(RUNTIME_DIR)) {
    throw new Error(`Runtime bundle missing at ${RUNTIME_DIR}. Run \`pnpm build:runtime\` first.`);
  }

  const app = express();
  app.use(cors());
  app.use("/runtime", express.static(RUNTIME_DIR));

  const store = getWidgetStore();

  app.get("/widget/:name/:hash/files", async (req, res) => {
    const { name, hash } = req.params;
    try {
      const widget = await store.getWidget(name, hash);
      if (!widget) {
        res.status(404).json({ error: "Widget not found" });
        return;
      }
      res.json({ files: widget.files, entry: widget.entry, manifest: widget.manifest });
    } catch (err) {
      error("e2e-visual", "Error serving widget files:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "patchwork-e2e-visual" });
  });

  await new Promise<void>((resolve) => {
    app.listen(WIDGET_PORT, "0.0.0.0", () => {
      log("e2e-visual", `Widget server listening on http://0.0.0.0:${WIDGET_PORT}`);
      resolve();
    });
  });
}

function printSummaryTable(entries: WidgetPreviewEntry[]): void {
  console.log("\n┌─────────────────────┬─────────────────────────────────────────────────┐");
  console.log("│ Widget              │ Preview URL                                     │");
  console.log("├─────────────────────┼─────────────────────────────────────────────────┤");
  for (const entry of entries) {
    const namePad = entry.name.padEnd(19);
    const urlPad = entry.url.length > 47 ? entry.url : entry.url.padEnd(47);
    console.log(`│ ${namePad} │ ${urlPad} │`);
  }
  console.log("└─────────────────────┴─────────────────────────────────────────────────┘\n");
}

async function savePreviewManifest(entries: WidgetPreviewEntry[]): Promise<void> {
  await mkdir(ARTIFACTS_DIR, { recursive: true });
  const manifestPath = resolve(ARTIFACTS_DIR, "preview-urls.json");
  await writeFile(manifestPath, JSON.stringify({ generatedAt: new Date().toISOString(), widgets: entries }, null, 2));
  log("e2e-visual", `Preview manifest saved to ${manifestPath}`);
}

async function main(): Promise<void> {
  const { tunnel } = parseArgs();

  log("e2e-visual", "Saving reference widgets...");
  const widgets = await saveReferenceWidgets();
  log("e2e-visual", `Saved ${widgets.length} widget(s)`);

  log("e2e-visual", "Starting widget server...");
  await startWidgetServer();

  let baseUrl = `http://localhost:${WIDGET_PORT}`;

  if (tunnel) {
    log("e2e-visual", "Starting Cloudflare tunnel...");
    try {
      baseUrl = await startTunnel(WIDGET_PORT);
      log("e2e-visual", `Tunnel established: ${baseUrl}`);
    } catch (err) {
      error("e2e-visual", "Failed to start tunnel, using localhost:", err);
    }
  }

  const entries: WidgetPreviewEntry[] = widgets.map((w) => ({
    name: w.name,
    hash: w.hash,
    url: `${baseUrl}/runtime/?widget=${w.name}/${w.hash}`,
  }));

  printSummaryTable(entries);
  await savePreviewManifest(entries);

  if (tunnel) {
    log("e2e-visual", "Tunnel mode active. Press Ctrl+C to shut down cleanly.");
    const shutdown = () => {
      log("e2e-visual", "Shutting down...");
      stopTunnel();
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  } else {
    log("e2e-visual", "Done (no tunnel). Use --tunnel for live preview URLs.");
    process.exit(0);
  }
}

main().catch((err: unknown) => {
  error("e2e-visual", "Fatal error:", err);
  stopTunnel();
  process.exit(1);
});
