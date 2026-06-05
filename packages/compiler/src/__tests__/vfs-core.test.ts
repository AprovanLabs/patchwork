import { describe, it, expect } from "vitest";
import {
  createFileStats,
  createDirEntry,
  normalizePath,
  dirname,
  basename,
  join,
} from "../vfs/core/utils.js";
import { hashContent } from "../vfs/sync/differ.js";
import { resolveConflict } from "../vfs/sync/resolver.js";
import type {
  FileStats,
  DirEntry,
  WatchEventType,
  ConflictStrategy,
  SyncStatus,
  SyncEventType,
} from "../vfs/core/types.js";
import type { ConflictResolutionInput } from "../vfs/sync/resolver.js";

describe("vfs/core/types", () => {
  describe("FileStats (via createFileStats)", () => {
    it("creates a file stat entry", () => {
      const mtime = new Date("2025-01-01T00:00:00Z");
      const stats: FileStats = createFileStats(1024, mtime);
      expect(stats.size).toBe(1024);
      expect(stats.mtime).toBe(mtime);
      expect(stats.isFile()).toBe(true);
      expect(stats.isDirectory()).toBe(false);
    });

    it("creates a directory stat entry", () => {
      const mtime = new Date("2025-06-01T12:00:00Z");
      const stats: FileStats = createFileStats(0, mtime, true);
      expect(stats.size).toBe(0);
      expect(stats.mtime).toBe(mtime);
      expect(stats.isFile()).toBe(false);
      expect(stats.isDirectory()).toBe(true);
    });
  });

  describe("DirEntry (via createDirEntry)", () => {
    it("creates a file dir entry", () => {
      const entry: DirEntry = createDirEntry("foo.ts", false);
      expect(entry.name).toBe("foo.ts");
      expect(entry.isFile()).toBe(true);
      expect(entry.isDirectory()).toBe(false);
    });

    it("creates a directory dir entry", () => {
      const entry: DirEntry = createDirEntry("src", true);
      expect(entry.name).toBe("src");
      expect(entry.isFile()).toBe(false);
      expect(entry.isDirectory()).toBe(true);
    });
  });

  describe("WatchEventType", () => {
    it("accepts valid event types", () => {
      const events: WatchEventType[] = ["create", "update", "delete"];
      expect(events).toHaveLength(3);
      expect(events).toContain("create");
      expect(events).toContain("update");
      expect(events).toContain("delete");
    });
  });

  describe("ConflictStrategy", () => {
    it("accepts valid strategies", () => {
      const strategies: ConflictStrategy[] = [
        "local-wins",
        "remote-wins",
        "newest-wins",
        "manual",
      ];
      expect(strategies).toHaveLength(4);
    });
  });

  describe("SyncStatus", () => {
    it("accepts valid statuses", () => {
      const statuses: SyncStatus[] = ["idle", "syncing", "error"];
      expect(statuses).toHaveLength(3);
    });
  });

  describe("SyncEventType", () => {
    it("accepts valid event types", () => {
      const types: SyncEventType[] = ["change", "conflict", "error", "status"];
      expect(types).toHaveLength(4);
    });
  });
});

describe("vfs/core/utils", () => {
  describe("normalizePath", () => {
    it("removes leading and trailing slashes", () => {
      expect(normalizePath("/foo/bar/")).toBe("foo/bar");
    });

    it("collapses multiple slashes", () => {
      expect(normalizePath("foo///bar")).toBe("foo/bar");
    });

    it("returns empty string for root", () => {
      expect(normalizePath("/")).toBe("");
    });

    it("handles already-normalized paths", () => {
      expect(normalizePath("foo/bar")).toBe("foo/bar");
    });
  });

  describe("dirname", () => {
    it("returns parent directory", () => {
      expect(dirname("foo/bar/baz.ts")).toBe("foo/bar");
    });

    it("returns empty string for top-level file", () => {
      expect(dirname("foo.ts")).toBe("");
    });

    it("handles paths with leading slashes", () => {
      expect(dirname("/foo/bar.ts")).toBe("foo");
    });
  });

  describe("basename", () => {
    it("returns file name from path", () => {
      expect(basename("foo/bar/baz.ts")).toBe("baz.ts");
    });

    it("returns the name itself for top-level file", () => {
      expect(basename("foo.ts")).toBe("foo.ts");
    });
  });

  describe("join", () => {
    it("joins path segments", () => {
      expect(join("foo", "bar")).toBe("foo/bar");
    });

    it("filters empty segments", () => {
      expect(join("foo", "", "bar")).toBe("foo/bar");
    });

    it("handles single segment", () => {
      expect(join("foo")).toBe("foo");
    });

    it("normalizes the result", () => {
      expect(join("foo/", "/bar")).toBe("foo/bar");
    });
  });
});

describe("vfs/sync/differ", () => {
  describe("hashContent", () => {
    it("produces deterministic hashes", () => {
      expect(hashContent("hello")).toBe(hashContent("hello"));
    });

    it("produces different hashes for different content", () => {
      expect(hashContent("hello")).not.toBe(hashContent("world"));
    });

    it("returns 8-character hex string", () => {
      const hash = hashContent("test");
      expect(hash).toMatch(/^[0-9a-f]{8}$/);
    });

    it("handles empty string", () => {
      const hash = hashContent("");
      expect(hash).toMatch(/^[0-9a-f]{8}$/);
    });
  });
});

describe("vfs/sync/resolver", () => {
  describe("resolveConflict", () => {
    const baseInput = {
      path: "src/app.tsx",
      changeMtime: new Date("2025-01-01T00:00:00Z"),
      remoteMtime: new Date("2025-01-02T00:00:00Z"),
      strategy: "local-wins" as ConflictStrategy,
    };

    it("returns null when remote is not newer", () => {
      const input: ConflictResolutionInput = {
        ...baseInput,
        remoteMtime: new Date("2024-12-31T00:00:00Z"),
      };
      expect(resolveConflict(input)).toBeNull();
    });

    it("returns null when checksums match", () => {
      const input: ConflictResolutionInput = {
        ...baseInput,
        localChecksum: "abc12345",
        remoteChecksum: "abc12345",
      };
      expect(resolveConflict(input)).toBeNull();
    });

    it("resolves local-wins strategy", () => {
      const result = resolveConflict(baseInput);
      expect(result).not.toBeNull();
      expect(result!.resolved).toBe("local");
    });

    it("resolves remote-wins strategy", () => {
      const input: ConflictResolutionInput = {
        ...baseInput,
        strategy: "remote-wins",
      };
      const result = resolveConflict(input);
      expect(result).not.toBeNull();
      expect(result!.resolved).toBe("remote");
    });

    it("resolves newest-wins with remote newer", () => {
      const input: ConflictResolutionInput = {
        ...baseInput,
        strategy: "newest-wins",
      };
      const result = resolveConflict(input);
      expect(result).not.toBeNull();
      expect(result!.resolved).toBe("remote");
    });

    it("returns null for newest-wins when local is newer", () => {
      const input: ConflictResolutionInput = {
        path: "src/app.tsx",
        changeMtime: new Date("2025-01-03T00:00:00Z"),
        remoteMtime: new Date("2025-01-02T00:00:00Z"),
        strategy: "newest-wins",
      };
      expect(resolveConflict(input)).toBeNull();
    });

    it("leaves manual conflicts unresolved", () => {
      const input: ConflictResolutionInput = {
        ...baseInput,
        strategy: "manual",
      };
      const result = resolveConflict(input);
      expect(result).not.toBeNull();
      expect(result!.resolved).toBeUndefined();
    });

    it("includes conflict metadata", () => {
      const result = resolveConflict(baseInput);
      expect(result!.path).toBe("src/app.tsx");
      expect(result!.localMtime).toEqual(baseInput.changeMtime);
      expect(result!.remoteMtime).toEqual(baseInput.remoteMtime);
    });
  });
});
