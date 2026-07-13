import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  REFERENCE_WIDGET_FILES,
  REFERENCE_WIDGET_MANIFEST,
} from "../reference-widgets/live-dashboard.js";
import type { Manifest, VirtualFile } from "@aprovan/patchwork-compiler";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARTIFACTS_DIR = resolve(__dirname, "../../../../.artifacts/widgets");

const WIDGETS: Array<{ manifest: Manifest; files: VirtualFile[] }> = [
  { manifest: REFERENCE_WIDGET_MANIFEST, files: REFERENCE_WIDGET_FILES },
];

/**
 * Export the raw source of each reference widget to .artifacts/widgets/<name>/.
 *
 * Widgets are no longer compiled on the server — they are saved as raw source
 * and compiled in the browser by the shared runtime. This script just dumps the
 * raw files (plus manifest.json) for inspection.
 */
async function main(): Promise<void> {
  console.log("Exporting raw widget source artifacts...\n");

  for (const { manifest, files } of WIDGETS) {
    const widgetDir = join(ARTIFACTS_DIR, manifest.name);
    await mkdir(widgetDir, { recursive: true });

    for (const file of files) {
      const outPath = join(widgetDir, file.path);
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, file.content, "utf-8");
    }
    await writeFile(
      join(widgetDir, "manifest.json"),
      JSON.stringify(manifest, null, 2),
      "utf-8",
    );

    console.log(`  ${manifest.name} → ${widgetDir} (${files.length} files)`);
  }

  console.log("\nDone. Render widgets via the runtime host to see them compiled.");
}

main().catch((err) => {
  console.error("Export failed:", err);
  process.exit(1);
});
