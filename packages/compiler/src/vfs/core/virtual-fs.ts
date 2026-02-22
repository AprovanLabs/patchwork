import type {
  ChangeRecord,
  DirEntry,
  FileStats,
  FSProvider,
  WatchCallback,
  WatchEventType,
} from "./types.js";
import { MemoryBackend } from "../backends/memory.js";

type ChangeListener = (record: ChangeRecord) => void;

/**
 * VirtualFS wraps an FSProvider with change tracking.
 * Tracks all local modifications for sync operations.
 */
export class VirtualFS implements FSProvider {
  private changes = new Map<string, ChangeRecord>();
  private listeners = new Set<ChangeListener>();
  private backend: FSProvider;

  constructor(backend?: FSProvider) {
    this.backend = backend ?? new MemoryBackend();
  }

  async readFile(path: string, encoding?: "utf8" | "base64"): Promise<string> {
    return this.backend.readFile(path, encoding);
  }

  async writeFile(path: string, content: string): Promise<void> {
    const existed = await this.backend.exists(path);
    await this.backend.writeFile(path, content);
    this.recordChange(path, existed ? "update" : "create");
  }

  async applyRemoteFile(path: string, content: string): Promise<void> {
    await this.backend.writeFile(path, content);
  }

  async applyRemoteDelete(path: string): Promise<void> {
    try {
      if (await this.backend.exists(path)) {
        await this.backend.unlink(path);
      }
    } catch {
      return;
    }
  }

  async unlink(path: string): Promise<void> {
    await this.backend.unlink(path);
    this.recordChange(path, "delete");
  }

  async stat(path: string): Promise<FileStats> {
    return this.backend.stat(path);
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    return this.backend.mkdir(path, options);
  }

  async readdir(path: string): Promise<DirEntry[]> {
    return this.backend.readdir(path);
  }

  async rmdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    return this.backend.rmdir(path, options);
  }

  async exists(path: string): Promise<boolean> {
    return this.backend.exists(path);
  }

  watch(path: string, callback: WatchCallback): () => void {
    if (this.backend.watch) {
      return this.backend.watch(path, callback);
    }
    return () => {};
  }

  /**
   * Get all pending changes since last sync
   */
  getChanges(): ChangeRecord[] {
    return Array.from(this.changes.values());
  }

  /**
   * Clear change tracking (after successful sync)
   */
  clearChanges(): void {
    this.changes.clear();
  }

  /**
   * Mark specific paths as synced
   */
  markSynced(paths: string[]): void {
    for (const path of paths) {
      this.changes.delete(path);
    }
  }

  /**
   * Subscribe to change events
   */
  onChange(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private recordChange(path: string, type: WatchEventType): void {
    const record: ChangeRecord = { path, type, mtime: new Date() };
    this.changes.set(path, record);
    for (const listener of this.listeners) {
      listener(record);
    }
  }
}
