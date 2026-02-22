import type {
  DirEntry,
  FileStats,
  FSProvider,
  WatchCallback,
} from "../core/types.js";
import {
  basename,
  createDirEntry,
  createFileStats,
  dirname,
  normalizePath,
} from "../core/utils.js";

interface FileEntry {
  content: string;
  mtime: Date;
}

/**
 * In-memory FSProvider implementation.
 * Useful for tests and ephemeral file systems.
 */
export class MemoryBackend implements FSProvider {
  private files = new Map<string, FileEntry>();
  private dirs = new Set<string>([""]);
  private watchers = new Map<string, Set<WatchCallback>>();

  async readFile(path: string): Promise<string> {
    const entry = this.files.get(normalizePath(path));
    if (!entry) throw new Error(`ENOENT: ${path}`);
    return entry.content;
  }

  async writeFile(path: string, content: string): Promise<void> {
    const normalized = normalizePath(path);
    const dir = dirname(normalized);
    if (dir && !this.dirs.has(dir)) {
      throw new Error(`ENOENT: ${dir}`);
    }
    const isNew = !this.files.has(normalized);
    this.files.set(normalized, { content, mtime: new Date() });
    this.emit(isNew ? "create" : "update", normalized);
  }

  async unlink(path: string): Promise<void> {
    const normalized = normalizePath(path);
    if (!this.files.delete(normalized)) {
      throw new Error(`ENOENT: ${path}`);
    }
    this.emit("delete", normalized);
  }

  async stat(path: string): Promise<FileStats> {
    const normalized = normalizePath(path);
    const entry = this.files.get(normalized);
    if (entry) {
      return createFileStats(entry.content.length, entry.mtime, false);
    }
    if (this.dirs.has(normalized)) {
      return createFileStats(0, new Date(), true);
    }
    throw new Error(`ENOENT: ${path}`);
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    const normalized = normalizePath(path);
    if (this.dirs.has(normalized)) return;

    const parent = dirname(normalized);
    if (parent && !this.dirs.has(parent)) {
      if (options?.recursive) {
        await this.mkdir(parent, options);
      } else {
        throw new Error(`ENOENT: ${parent}`);
      }
    }
    this.dirs.add(normalized);
  }

  async readdir(path: string): Promise<DirEntry[]> {
    const normalized = normalizePath(path);
    if (!this.dirs.has(normalized)) {
      throw new Error(`ENOENT: ${path}`);
    }

    const prefix = normalized ? `${normalized}/` : "";
    const entries = new Map<string, boolean>();

    for (const filePath of this.files.keys()) {
      if (filePath.startsWith(prefix)) {
        const rest = filePath.slice(prefix.length);
        const name = rest.split("/")[0];
        if (name) entries.set(name, false);
      }
    }

    for (const dirPath of this.dirs) {
      if (dirPath.startsWith(prefix) && dirPath !== normalized) {
        const rest = dirPath.slice(prefix.length);
        const name = rest.split("/")[0];
        if (name) entries.set(name, true);
      }
    }

    return Array.from(entries).map(([name, isDir]) =>
      createDirEntry(name, isDir),
    );
  }

  async rmdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    const normalized = normalizePath(path);
    if (!this.dirs.has(normalized)) {
      throw new Error(`ENOENT: ${path}`);
    }

    const prefix = `${normalized}/`;
    const hasChildren =
      [...this.files.keys()].some((p) => p.startsWith(prefix)) ||
      [...this.dirs].some((d) => d.startsWith(prefix));

    if (hasChildren && !options?.recursive) {
      throw new Error(`ENOTEMPTY: ${path}`);
    }

    if (options?.recursive) {
      for (const filePath of this.files.keys()) {
        if (filePath.startsWith(prefix)) {
          this.files.delete(filePath);
          this.emit("delete", filePath);
        }
      }
      for (const dirPath of this.dirs) {
        if (dirPath.startsWith(prefix)) {
          this.dirs.delete(dirPath);
        }
      }
    }

    this.dirs.delete(normalized);
  }

  async exists(path: string): Promise<boolean> {
    const normalized = normalizePath(path);
    return this.files.has(normalized) || this.dirs.has(normalized);
  }

  watch(path: string, callback: WatchCallback): () => void {
    const normalized = normalizePath(path);
    let callbacks = this.watchers.get(normalized);
    if (!callbacks) {
      callbacks = new Set();
      this.watchers.set(normalized, callbacks);
    }
    callbacks.add(callback);
    return () => callbacks!.delete(callback);
  }

  private emit(event: "create" | "update" | "delete", path: string): void {
    // Notify watchers for this path and all parent paths
    let current = path;
    while (true) {
      const callbacks = this.watchers.get(current);
      if (callbacks) {
        for (const cb of callbacks) cb(event, path);
      }
      if (!current) break;
      current = dirname(current);
    }
  }
}
