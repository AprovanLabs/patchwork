import { describe, it, expect } from "vitest";
import { compileWidget, cacheHas } from "../compiler/compile.js";
import { clear } from "../compiler/cache.js";
import { createProjectFromFiles } from "@aprovan/patchwork-compiler";
import type { Manifest } from "@aprovan/patchwork-compiler";

const TEST_MANIFEST: Manifest = {
  name: "integration-test",
  version: "0.1.0",
  platform: "browser",
  image: "@aprovan/patchwork-image-shadcn",
};

const SIMPLE_WIDGET = `export default function Widget() {
  return <div className="p-4 bg-blue-100">Hello Widget</div>;
}`;

describe("compile integration", () => {
  it("compiles a simple widget and returns HTML", async () => {
    const result = await compileWidget(SIMPLE_WIDGET, TEST_MANIFEST);

    expect(result.html).toContain("<!DOCTYPE html>");
    expect(result.html).toContain("id=\"root\"");
    expect(result.hash).toBeTruthy();
    expect(result.resourceUri).toMatch(/^ui:\/\/widget\//);
  }, 60000);

  it("caches compiled output", async () => {
    clear();
    const result1 = await compileWidget(SIMPLE_WIDGET, TEST_MANIFEST);
    expect(cacheHas(result1.hash)).toBe(true);

    const result2 = await compileWidget(SIMPLE_WIDGET, TEST_MANIFEST);
    expect(result2.hash).toBe(result1.hash);
    expect(result2.html).toBe(result1.html);
    expect(result2.resourceUri).toBe(result1.resourceUri);
  }, 60000);

  it("includes CDN preload scripts in output HTML", async () => {
    const result = await compileWidget(SIMPLE_WIDGET, TEST_MANIFEST);
    expect(result.html).toContain("esm.sh/react");
  }, 60000);

  it("includes Tailwind CDN in output HTML", async () => {
    const result = await compileWidget(SIMPLE_WIDGET, TEST_MANIFEST);
    expect(result.html).toContain("tailwindcss");
  }, 60000);

  it("includes shadcn CSS variables in output HTML", async () => {
    const result = await compileWidget(SIMPLE_WIDGET, TEST_MANIFEST);
    expect(result.html).toContain("--background");
    expect(result.html).toContain("--foreground");
  }, 60000);

  it("compiles a multi-file VirtualProject", async () => {
    const project = createProjectFromFiles([
      { path: "main.tsx", content: 'import { Greeting } from "./greeting"; export default function Widget() { return <Greeting name="World" />; }' },
      { path: "greeting.tsx", content: 'export function Greeting({ name }: { name: string }) { return <div className="p-2">Hello, {name}!</div>; }' },
    ]);

    const result = await compileWidget(project, TEST_MANIFEST);
    expect(result.html).toContain("<!DOCTYPE html>");
    expect(result.hash).toBeTruthy();
  }, 60000);

  it("injects service shim when services option is provided", async () => {
    const result = await compileWidget(SIMPLE_WIDGET, TEST_MANIFEST, {
      services: ["weather", "stripe"],
    });

    expect(result.html).toContain("<!DOCTYPE html>");
    expect(result.html).toContain("import { App } from");
    expect(result.html).toContain("esm.sh/@modelcontextprotocol/ext-apps");
    expect(result.html).toContain("weather");
    expect(result.html).toContain("stripe");
    expect(result.html).toContain("__patchwork_createNamespaceProxy");
    expect(result.html).toContain("callServerTool");
  }, 60000);

  it("does not inject shim when services is empty", async () => {
    const result = await compileWidget(SIMPLE_WIDGET, TEST_MANIFEST, {
      services: [],
    });

    expect(result.html).not.toContain("__patchwork_createNamespaceProxy");
  }, 60000);

  it("does not inject shim when services option is not provided", async () => {
    const result = await compileWidget(SIMPLE_WIDGET, TEST_MANIFEST);

    expect(result.html).not.toContain("__patchwork_createNamespaceProxy");
  }, 60000);
});
