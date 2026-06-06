import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createProjectFromFiles } from "@aprovan/patchwork-compiler";
import { compileWidget } from "../compiler/compile.js";
import {
  REFERENCE_WIDGET_FILES,
  REFERENCE_WIDGET_MANIFEST,
} from "../reference-widgets/live-dashboard.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARTIFACTS_DIR = resolve(__dirname, "../../../../.artifacts/widgets");

const WIDGETS = [
  { manifest: REFERENCE_WIDGET_MANIFEST, files: REFERENCE_WIDGET_FILES },
];

async function main(): Promise<void> {
  console.log("Exporting widget HTML artifacts...\n");
  await mkdir(ARTIFACTS_DIR, { recursive: true });

  for (const { manifest, files } of WIDGETS) {
    process.stdout.write(`  Compiling ${manifest.name}...`);
    const project = createProjectFromFiles(files);
    const { html } = await compileWidget(project, manifest, {
      services: manifest.services,
    });
    const outPath = join(ARTIFACTS_DIR, `${manifest.name}.html`);
    await writeFile(outPath, html, "utf-8");
    console.log(` saved → ${outPath}`);
  }

  console.log("\nDone. Open any .html file in a browser to inspect the widget.");
}

main().catch((err) => {
  console.error("Export failed:", err);
  process.exit(1);
});
