import type { DirEntry, FileStats } from "./types.js";

export function createFileStats(
  size: number,
  mtime: Date,
  isDir = false,
): FileStats {
  return {
    size,
    mtime,
    isFile: () => !isDir,
    isDirectory: () => isDir,
  };
}

export function createDirEntry(name: string, isDir: boolean): DirEntry {
  return {
    name,
    isFile: () => !isDir,
    isDirectory: () => isDir,
  };
}

export function normalizePath(path: string): string {
  return path.replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
}

export function dirname(path: string): string {
  const normalized = normalizePath(path);
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash === -1 ? "" : normalized.slice(0, lastSlash);
}

export function basename(path: string): string {
  const normalized = normalizePath(path);
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash === -1 ? normalized : normalized.slice(lastSlash + 1);
}

export function join(...parts: string[]): string {
  return normalizePath(parts.filter(Boolean).join("/"));
}
