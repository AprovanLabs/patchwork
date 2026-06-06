import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProjectFromFiles } from "@aprovan/patchwork-compiler";
import { describe, it, expect, beforeEach } from "vitest";
import { saveWidgetArtifact } from "../artifacts.js";
import { clear } from "../compiler/cache.js";
import { compileWidget } from "../compiler/compile.js";
import {
  REFERENCE_WIDGET_FILES,
  REFERENCE_WIDGET_MANIFEST,
} from "../reference-widgets/live-dashboard.js";

describe("E2E: HTML artifact export for compiled widgets", () => {
  beforeEach(() => {
    clear();
  });

  it("saves compiled live-dashboard HTML to .artifacts/widgets/live-dashboard.html", async () => {
    const project = createProjectFromFiles(REFERENCE_WIDGET_FILES);
    const result = await compileWidget(project, REFERENCE_WIDGET_MANIFEST, {
      services: REFERENCE_WIDGET_MANIFEST.services,
    });

    // Use a temp dir so the test is self-contained and does not require repo-root write access in CI
    const artifactsDir = join(tmpdir(), "patchwork-artifacts-test", "widgets");
    const savedPath = await saveWidgetArtifact(
      REFERENCE_WIDGET_MANIFEST.name,
      result.html,
      artifactsDir,
    );

    expect(savedPath).toMatch(/live-dashboard\.html$/);

    const html = await readFile(savedPath, "utf-8");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('id="root"');
    // Confirm all required self-contained elements are present
    expect(html).toContain("tailwindcss");
    expect(html).toContain("--background");
    expect(html).toContain("window.patchwork");
  }, 60000);

  it("saved artifact HTML renders standalone (all resources inlined)", async () => {
    const project = createProjectFromFiles(REFERENCE_WIDGET_FILES);
    const result = await compileWidget(project, REFERENCE_WIDGET_MANIFEST, {
      services: REFERENCE_WIDGET_MANIFEST.services,
    });

    const artifactsDir = join(tmpdir(), "patchwork-artifacts-test", "widgets");
    const savedPath = await saveWidgetArtifact(
      REFERENCE_WIDGET_MANIFEST.name,
      result.html,
      artifactsDir,
    );

    const html = await readFile(savedPath, "utf-8");
    // Service shim (namespace proxy) should be present
    expect(html).toContain("__patchwork_createNamespaceProxy");
    // esm.sh React preload should be inlined
    expect(html).toContain("esm.sh/react");
    // shadcn CSS variables should be embedded
    expect(html).toContain("--foreground");
  }, 60000);

  it("saveWidgetArtifact creates missing directories and overwrites existing files", async () => {
    const artifactsDir = join(tmpdir(), "patchwork-artifacts-overwrite-test", "widgets", "nested");
    const path1 = await saveWidgetArtifact("test-widget", "<html>v1</html>", artifactsDir);
    const path2 = await saveWidgetArtifact("test-widget", "<html>v2</html>", artifactsDir);

    expect(path1).toBe(path2);
    const contents = await readFile(path2, "utf-8");
    expect(contents).toBe("<html>v2</html>");
  });
});
