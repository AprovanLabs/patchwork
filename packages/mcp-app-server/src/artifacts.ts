import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// packages/mcp-app-server/src → up 3 levels → repo root
const REPO_ROOT = resolve(__dirname, "../../..");
const DEFAULT_WIDGETS_DIR = join(REPO_ROOT, ".artifacts", "widgets");

/**
 * Save a compiled widget HTML file to the `.artifacts/widgets/` directory.
 *
 * Creates the directory if it does not exist. The file is named `<name>.html`.
 *
 * @param name - Widget name (used as the filename stem)
 * @param html - Self-contained HTML string produced by `compileWidget`
 * @param artifactsDir - Override the target directory (default: `<repo-root>/.artifacts/widgets`)
 * @returns The absolute path of the saved file
 */
export async function saveWidgetArtifact(
  name: string,
  html: string,
  artifactsDir?: string,
): Promise<string> {
  const dir = artifactsDir ?? DEFAULT_WIDGETS_DIR;
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, `${name}.html`);
  await writeFile(filePath, html, "utf-8");
  return filePath;
}
