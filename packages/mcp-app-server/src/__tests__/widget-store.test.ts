import { describe, it, expect, beforeEach } from "vitest";
import { WidgetStore, resetWidgetStore } from "../widget-store/store.js";
import type { Manifest } from "@aprovan/patchwork-compiler";
import { MemoryBackend } from "./memory-backend.js";

const TEST_MANIFEST: Manifest = {
  name: "test-widget",
  version: "0.1.0",
  platform: "browser",
  image: "@aprovan/patchwork-image-shadcn",
};

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
    it("persists a widget and returns stored metadata", async () => {
      const result = await store.saveWidget("abc123", "<html>test</html>", TEST_MANIFEST);

      expect(result.path).toBe("widgets/test-widget/abc123/view.html");
      expect(result.resourceUri).toBe("ui://widgets/test-widget/abc123/view.html");
      expect(result.html).toBe("<html>test</html>");
      expect(result.manifest.name).toBe("test-widget");
      expect(result.createdAt).toBeTypeOf("number");
    });

    it("stores manifest with entry for multi-file projects", async () => {
      const result = await store.saveWidget(
        "def456",
        "<html>multi</html>",
        { ...TEST_MANIFEST, name: "multi-widget" },
        "main.tsx",
      );

      expect(result.entry).toBe("main.tsx");
    });

    it("stores manifest with services metadata", async () => {
      const manifest: Manifest = {
        ...TEST_MANIFEST,
        services: ["weather", "github"],
      };
      const result = await store.saveWidget("svc123", "<html>svc</html>", manifest);

      expect(result.manifest.services).toEqual(["weather", "github"]);
    });
  });

  describe("getWidget", () => {
    it("retrieves a stored widget by name and hash", async () => {
      await store.saveWidget("abc123", "<html>test</html>", TEST_MANIFEST);
      const widget = await store.getWidget("test-widget", "abc123");

      expect(widget).not.toBeNull();
      expect(widget!.html).toBe("<html>test</html>");
      expect(widget!.manifest.name).toBe("test-widget");
      expect(widget!.resourceUri).toBe("ui://widgets/test-widget/abc123/view.html");
    });

    it("returns null for non-existent widget", async () => {
      const widget = await store.getWidget("nonexistent", "nothash");
      expect(widget).toBeNull();
    });

    it("retrieves entry point from manifest", async () => {
      await store.saveWidget("ent123", "<html>entry</html>", TEST_MANIFEST, "app.tsx");
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
      await store.saveWidget("abc123", "<html>a</html>", TEST_MANIFEST);
      await store.saveWidget(
        "def456",
        "<html>b</html>",
        { ...TEST_MANIFEST, name: "other-widget", description: "Another widget" },
      );

      const widgets = await store.listWidgets();
      expect(widgets).toHaveLength(2);
      expect(widgets.map((w) => w.name)).toContain("test-widget");
      expect(widgets.map((w) => w.name)).toContain("other-widget");
    });

    it("includes services and entry in listing", async () => {
      await store.saveWidget(
        "svc123",
        "<html>svc</html>",
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
      await store.saveWidget("old", "<html>old</html>", { ...TEST_MANIFEST, name: "old-widget" });

      await new Promise((r) => setTimeout(r, 10));

      await store.saveWidget("new", "<html>new</html>", { ...TEST_MANIFEST, name: "new-widget" });

      const widgets = await store.listWidgets();
      expect(widgets[0]!.name).toBe("new-widget");
    });
  });

  describe("deleteWidget", () => {
    it("deletes a stored widget", async () => {
      await store.saveWidget("del123", "<html>del</html>", TEST_MANIFEST);
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
      await store.saveWidget("has123", "<html>has</html>", TEST_MANIFEST);
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
      await store.saveWidget("abc123", "<html>a</html>", TEST_MANIFEST);
      await store.saveWidget(
        "def456",
        "<html>b</html>",
        { ...TEST_MANIFEST, name: "other-widget" },
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
