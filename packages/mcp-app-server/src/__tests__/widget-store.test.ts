import { describe, it, expect, beforeEach } from "vitest";
import { WidgetStore, resetWidgetStore } from "../widget-store/store.js";
import { MemoryBackend } from "./memory-backend.js";
import type { Manifest, VirtualFile } from "@aprovan/patchwork-compiler";

const TEST_MANIFEST: Manifest = {
  name: "test-widget",
  version: "0.1.0",
  platform: "browser",
  image: "@aprovan/patchwork-image-shadcn",
};

const SINGLE_FILE: VirtualFile[] = [
  { path: "main.tsx", content: "export default () => <div>test</div>;" },
];

function createStore(): WidgetStore {
  resetWidgetStore();
  return new WidgetStore({ backend: new MemoryBackend() });
}

describe("WidgetStore", () => {
  let store: WidgetStore;

  beforeEach(() => {
    store = createStore();
  });

  describe("saveWidget", () => {
    it("persists raw widget files and returns stored metadata", async () => {
      const result = await store.saveWidget("abc123", SINGLE_FILE, TEST_MANIFEST, "main.tsx");

      expect(result.path).toBe("widgets/test-widget/abc123");
      expect(result.resourceUri).toBe("ui://widgets/test-widget/abc123/view.html");
      expect(result.files).toEqual(SINGLE_FILE);
      expect(result.entry).toBe("main.tsx");
      expect(result.manifest.name).toBe("test-widget");
      expect(result.createdAt).toBeTypeOf("number");
    });

    it("persists multi-file projects with nested paths", async () => {
      const files: VirtualFile[] = [
        { path: "main.tsx", content: "import './ui/card';" },
        { path: "ui/card.tsx", content: "export const Card = () => null;" },
      ];
      await store.saveWidget("def456", files, { ...TEST_MANIFEST, name: "multi" }, "main.tsx");

      const widget = await store.getWidget("multi", "def456");
      expect(widget!.files).toHaveLength(2);
      expect(widget!.files.map((f) => f.path).sort()).toEqual(["main.tsx", "ui/card.tsx"]);
    });

    it("stores manifest with services metadata", async () => {
      const manifest: Manifest = { ...TEST_MANIFEST, services: ["weather", "github"] };
      const result = await store.saveWidget("svc123", SINGLE_FILE, manifest, "main.tsx");

      expect(result.manifest.services).toEqual(["weather", "github"]);
    });
  });

  describe("getWidget", () => {
    it("retrieves stored raw files by name and hash", async () => {
      await store.saveWidget("abc123", SINGLE_FILE, TEST_MANIFEST, "main.tsx");
      const widget = await store.getWidget("test-widget", "abc123");

      expect(widget).not.toBeNull();
      expect(widget!.files).toEqual(SINGLE_FILE);
      expect(widget!.manifest.name).toBe("test-widget");
      expect(widget!.resourceUri).toBe("ui://widgets/test-widget/abc123/view.html");
    });

    it("returns null for non-existent widget", async () => {
      const widget = await store.getWidget("nonexistent", "nothash");
      expect(widget).toBeNull();
    });

    it("retrieves entry point from manifest", async () => {
      await store.saveWidget("ent123", SINGLE_FILE, TEST_MANIFEST, "app.tsx");
      const widget = await store.getWidget("test-widget", "ent123");

      expect(widget!.entry).toBe("app.tsx");
    });
  });

  describe("listWidgets", () => {
    it("returns empty list when no widgets stored", async () => {
      const widgets = await store.listWidgets();
      expect(widgets).toEqual([]);
    });

    it("lists all stored widgets with metadata", async () => {
      await store.saveWidget("abc123", SINGLE_FILE, TEST_MANIFEST, "main.tsx");
      await store.saveWidget(
        "def456",
        SINGLE_FILE,
        { ...TEST_MANIFEST, name: "other-widget", description: "Another widget" },
        "main.tsx",
      );

      const widgets = await store.listWidgets();
      expect(widgets).toHaveLength(2);
      expect(widgets.map((w) => w.name)).toContain("test-widget");
      expect(widgets.map((w) => w.name)).toContain("other-widget");
    });

    it("includes services and entry in listing", async () => {
      await store.saveWidget(
        "svc123",
        SINGLE_FILE,
        { ...TEST_MANIFEST, services: ["stripe"] },
        "main.tsx",
      );

      const widgets = await store.listWidgets();
      const entry = widgets.find((w) => w.name === "test-widget");
      expect(entry!.services).toEqual(["stripe"]);
      expect(entry!.entry).toBe("main.tsx");
    });

    it("returns widgets sorted by most recent first", async () => {
      const store = createStore();
      await store.saveWidget("old", SINGLE_FILE, { ...TEST_MANIFEST, name: "old-widget" }, "main.tsx");

      await new Promise((r) => setTimeout(r, 10));

      await store.saveWidget("new", SINGLE_FILE, { ...TEST_MANIFEST, name: "new-widget" }, "main.tsx");

      const widgets = await store.listWidgets();
      expect(widgets[0]!.name).toBe("new-widget");
    });
  });

  describe("deleteWidget", () => {
    it("deletes a stored widget", async () => {
      await store.saveWidget("del123", SINGLE_FILE, TEST_MANIFEST, "main.tsx");
      const deleted = await store.deleteWidget("test-widget", "del123");
      expect(deleted).toBe(true);

      const widget = await store.getWidget("test-widget", "del123");
      expect(widget).toBeNull();
    });

    it("returns false for non-existent widget", async () => {
      const deleted = await store.deleteWidget("nonexistent", "nothash");
      expect(deleted).toBe(false);
    });
  });

  describe("hasWidget", () => {
    it("returns true for stored widget", async () => {
      await store.saveWidget("has123", SINGLE_FILE, TEST_MANIFEST, "main.tsx");
      expect(await store.hasWidget("test-widget", "has123")).toBe(true);
    });

    it("returns false for non-existent widget", async () => {
      expect(await store.hasWidget("nonexistent", "nothash")).toBe(false);
    });
  });

  describe("resourceUriFor", () => {
    it("generates correct resource URI", () => {
      const uri = store.resourceUriFor("my-widget", "abc123");
      expect(uri).toBe("ui://widgets/my-widget/abc123/view.html");
    });
  });

  describe("loadAll", () => {
    it("loads all stored widgets", async () => {
      await store.saveWidget("abc123", SINGLE_FILE, TEST_MANIFEST, "main.tsx");
      await store.saveWidget(
        "def456",
        SINGLE_FILE,
        { ...TEST_MANIFEST, name: "other-widget" },
        "main.tsx",
      );

      const widgets = await store.loadAll();
      expect(widgets).toHaveLength(2);
      expect(widgets.map((w) => w.manifest.name)).toContain("test-widget");
      expect(widgets.map((w) => w.manifest.name)).toContain("other-widget");
    });

    it("returns empty array when no widgets stored", async () => {
      const widgets = await store.loadAll();
      expect(widgets).toEqual([]);
    });
  });
});
