/**
 * Standalone artifact export script.
 *
 * Compiles all reference widgets and saves the resulting self-contained HTML files
 * to `.artifacts/widgets/<widget-name>.html` without running any Playwright assertions.
 *
 * Usage:
 *   pnpm run artifacts:export
 *
 * The `.artifacts/` directory is created at the repository root if it does not exist.
 * Existing files are overwritten.
 */

import { createProjectFromFiles } from "@aprovan/patchwork-compiler";
import { saveWidgetArtifact } from "../artifacts.js";
import { compileWidget } from "../compiler/compile.js";
import {
  REFERENCE_WIDGET_FILES,
  REFERENCE_WIDGET_MANIFEST,
} from "../reference-widgets/live-dashboard.js";

const REFERENCE_WIDGETS = [
  {
    manifest: REFERENCE_WIDGET_MANIFEST,
    files: REFERENCE_WIDGET_FILES,
  },
];

async function main(): Promise<void> {
  console.log("Exporting widget HTML artifacts...\n");

  for (const { manifest, files } of REFERENCE_WIDGETS) {
    process.stdout.write(`  Compiling ${manifest.name}...`);
    const project = createProjectFromFiles(files);
    const result = await compileWidget(project, manifest, {
      services: manifest.services,
    });
    const savedPath = await saveWidgetArtifact(manifest.name, result.html);
    console.log(` saved → ${savedPath}`);
  }

  console.log("\nDone. Open any .html file in a browser to inspect the widget.");
}

main().catch((err) => {
  console.error("Export failed:", err);
  process.exit(1);
});
