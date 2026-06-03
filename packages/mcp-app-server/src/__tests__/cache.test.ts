import { describe, it, expect, beforeEach } from "vitest";
import {
  computeCacheKey,
  get,
  set,
  has,
  clear,
  size,
  allEntries,
  type CachedWidget,
} from "../compiler/cache.js";
import type { Manifest, VirtualProject } from "@aprovan/patchwork-compiler";

const TEST_MANIFEST: Manifest = {
  name: "test-widget",
  version: "0.1.0",
  platform: "browser",
  image: "@aprovan/patchwork-image-shadcn",
};

function makeCachedWidget(hash: string): CachedWidget {
  return {
    html: `<html><body>${hash}</body></html>`,
    manifest: TEST_MANIFEST,
    resourceUri: `ui://widget/${hash}/view.html`,
    createdAt: Date.now(),
  };
}

describe("cache", () => {
  beforeEach(() => {
    clear();
  });

  describe("computeCacheKey", () => {
    it("produces deterministic keys for the same string source", () => {
      const key1 = computeCacheKey("const x = 1", TEST_MANIFEST);
      const key2 = computeCacheKey("const x = 1", TEST_MANIFEST);
      expect(key1).toBe(key2);
    });

    it("produces different keys for different sources", () => {
      const key1 = computeCacheKey("const x = 1", TEST_MANIFEST);
      const key2 = computeCacheKey("const x = 2", TEST_MANIFEST);
      expect(key1).not.toBe(key2);
    });

    it("produces different keys for different manifests", () => {
      const otherManifest: Manifest = { ...TEST_MANIFEST, name: "other" };
      const key1 = computeCacheKey("const x = 1", TEST_MANIFEST);
      const key2 = computeCacheKey("const x = 1", otherManifest);
      expect(key1).not.toBe(key2);
    });

    it("handles VirtualProject input", () => {
      const project: VirtualProject = {
        id: "test",
        entry: "main.tsx",
        files: new Map([
          ["main.tsx", { path: "main.tsx", content: "export default function App() {}" }],
        ]),
      };
      const key = computeCacheKey(project, TEST_MANIFEST);
      expect(key).toBeTruthy();
      expect(key).toHaveLength(16);
    });

    it("produces same key for same VirtualProject", () => {
      const project: VirtualProject = {
        id: "test",
        entry: "main.tsx",
        files: new Map([
          ["main.tsx", { path: "main.tsx", content: "export default function App() {}" }],
        ]),
      };
      const key1 = computeCacheKey(project, TEST_MANIFEST);
      const key2 = computeCacheKey(project, TEST_MANIFEST);
      expect(key1).toBe(key2);
    });
  });

  describe("get / set / has", () => {
    it("returns undefined for missing keys", () => {
      expect(get("nonexistent")).toBeUndefined();
      expect(has("nonexistent")).toBe(false);
    });

    it("stores and retrieves entries", () => {
      const entry = makeCachedWidget("abc123");
      set("abc123", entry);
      expect(has("abc123")).toBe(true);
      expect(get("abc123")).toEqual(entry);
    });
  });

  describe("allEntries", () => {
    it("returns all cached entries", () => {
      set("a", makeCachedWidget("a"));
      set("b", makeCachedWidget("b"));
      const entries = allEntries();
      expect(entries).toHaveLength(2);
      expect(entries.map((e) => e[0])).toContain("a");
      expect(entries.map((e) => e[0])).toContain("b");
    });
  });

  describe("eviction", () => {
    it("evicts oldest entries when cache is full", () => {
      const originalSize = 256;
      for (let i = 0; i < originalSize + 10; i++) {
        set(`key-${i}`, {
          ...makeCachedWidget(`key-${i}`),
          createdAt: i * 1000,
        });
      }
      expect(size()).toBeLessThanOrEqual(originalSize);
    });
  });
});
