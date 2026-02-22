import type {
  ChangeRecord,
  ConflictRecord,
  ConflictStrategy,
  DirEntry,
  FSProvider,
  SyncEventCallback,
  SyncEventType,
  SyncResult,
  SyncStatus,
  WatchEventType,
} from "../core/types.js";
import type { VirtualFS } from "../core/virtual-fs.js";
import { join, normalizePath } from "../core/utils.js";
import { readChecksums } from "./differ.js";
import { resolveConflict } from "./resolver.js";

export interface SyncEngineConfig {
  conflictStrategy?: ConflictStrategy;
  basePath?: string;
}

type EventMap = {
  change: ChangeRecord;
  conflict: ConflictRecord;
  error: Error;
  status: SyncStatus;
};

/**
 * Bidirectional sync engine between local VirtualFS and remote FSProvider
 */
export class SyncEngineImpl {
  status: SyncStatus = "idle";
  private intervalId?: ReturnType<typeof setInterval>;
  private listeners = new Map<SyncEventType, Set<SyncEventCallback<unknown>>>();
  private conflictStrategy: ConflictStrategy;
  private basePath: string;

  constructor(
    private local: VirtualFS,
    private remote: FSProvider,
    config: SyncEngineConfig = {},
  ) {
    this.conflictStrategy = config.conflictStrategy ?? "local-wins";
    this.basePath = config.basePath ?? "";
    this.startRemoteWatch();
  }

  async sync(): Promise<SyncResult> {
    if (this.status === "syncing") {
      return { pushed: 0, pulled: 0, conflicts: [] };
    }

    this.setStatus("syncing");
    const result: SyncResult = { pushed: 0, pulled: 0, conflicts: [] };

    try {
      const localChanges = this.local.getChanges();
      const localChangeMap = new Map(
        localChanges.map((change) => [change.path, change]),
      );
      const syncedPaths: string[] = [];

      const remoteFiles = await this.listFiles(this.remote, this.basePath);
      const localFiles = await this.listFiles(this.local, "");
      const remoteLocalPaths = new Set(
        remoteFiles.map((path) => this.localPath(path)),
      );

      for (const remotePath of remoteFiles) {
        const localPath = this.localPath(remotePath);
        const localChange = localChangeMap.get(localPath);

        if (localChange) {
          const conflict = await this.checkConflict(localChange, remotePath);
          if (conflict) {
            result.conflicts.push(conflict);
            this.emit("conflict", conflict);
            if (conflict.resolved === "remote") {
              if (await this.pullRemoteFile(localPath, remotePath)) {
                result.pulled++;
                this.emit("change", {
                  path: localPath,
                  type: "update",
                  mtime: new Date(),
                });
              }
              syncedPaths.push(localPath);
            }
          }
          continue;
        }

        if (await this.pullRemoteFile(localPath, remotePath)) {
          result.pulled++;
          this.emit("change", {
            path: localPath,
            type: "update",
            mtime: new Date(),
          });
        }
      }

      for (const localPath of localFiles) {
        if (remoteLocalPaths.has(localPath)) continue;
        if (localChangeMap.has(localPath)) continue;
        await this.local.applyRemoteDelete(localPath);
        result.pulled++;
        this.emit("change", {
          path: localPath,
          type: "delete",
          mtime: new Date(),
        });
      }

      for (const change of localChanges) {
        if (syncedPaths.includes(change.path)) continue;
        const remotePath = this.remotePath(change.path);

        try {
          const conflict = await this.checkConflict(change, remotePath);
          if (conflict) {
            result.conflicts.push(conflict);
            this.emit("conflict", conflict);
            if (conflict.resolved === "remote") {
              if (await this.pullRemoteFile(change.path, remotePath)) {
                result.pulled++;
                this.emit("change", {
                  path: change.path,
                  type: "update",
                  mtime: new Date(),
                });
              }
              syncedPaths.push(change.path);
            }
            if (conflict.resolved !== "local") continue;
          }

          if (change.type === "delete") {
            if (await this.remote.exists(remotePath)) {
              await this.remote.unlink(remotePath);
            }
            result.pushed++;
            syncedPaths.push(change.path);
            this.emit("change", change);
            continue;
          }

          const content = await this.local.readFile(change.path);
          await this.remote.writeFile(remotePath, content);
          result.pushed++;
          syncedPaths.push(change.path);
          this.emit("change", change);
        } catch (err) {
          this.emit(
            "error",
            err instanceof Error ? err : new Error(String(err)),
          );
        }
      }

      if (syncedPaths.length > 0) {
        this.local.markSynced(syncedPaths);
      }
      this.setStatus("idle");
    } catch (err) {
      this.setStatus("error");
      this.emit("error", err instanceof Error ? err : new Error(String(err)));
    }

    return result;
  }

  startAutoSync(intervalMs: number): void {
    this.stopAutoSync();
    this.intervalId = setInterval(() => this.sync(), intervalMs);
  }

  stopAutoSync(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }

  on<T extends SyncEventType>(
    event: T,
    callback: SyncEventCallback<EventMap[T]>,
  ): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(callback as SyncEventCallback<unknown>);
    return () => set!.delete(callback as SyncEventCallback<unknown>);
  }

  private emit<T extends SyncEventType>(event: T, data: EventMap[T]): void {
    const set = this.listeners.get(event);
    if (set) {
      for (const cb of set) cb(data);
    }
  }

  private setStatus(status: SyncStatus): void {
    this.status = status;
    this.emit("status", status);
  }

  private remotePath(localPath: string): string {
    return this.basePath ? join(this.basePath, localPath) : localPath;
  }

  private localPath(remotePath: string): string {
    if (!this.basePath) return normalizePath(remotePath);
    const normalized = normalizePath(remotePath);
    const base = normalizePath(this.basePath);
    if (normalized === base) return "";
    if (normalized.startsWith(`${base}/`)) {
      return normalized.slice(base.length + 1);
    }
    return normalized;
  }

  private async listFiles(
    provider: FSProvider,
    basePath: string,
  ): Promise<string[]> {
    const normalized = normalizePath(basePath);
    let entries: DirEntry[] = [];
    try {
      entries = await provider.readdir(normalized);
    } catch {
      return [];
    }

    const results: string[] = [];
    for (const entry of entries) {
      const entryPath = normalized ? `${normalized}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        results.push(...(await this.listFiles(provider, entryPath)));
      } else {
        results.push(entryPath);
      }
    }

    return results;
  }

  private async pullRemoteFile(
    localPath: string,
    remotePath: string,
  ): Promise<boolean> {
    let localContent: string | null = null;
    try {
      if (await this.local.exists(localPath)) {
        localContent = await this.local.readFile(localPath);
      }
    } catch {
      localContent = null;
    }

    const remoteContent = await this.remote.readFile(remotePath);
    if (localContent === remoteContent) return false;
    await this.local.applyRemoteFile(localPath, remoteContent);
    return true;
  }

  private startRemoteWatch(): void {
    if (!this.remote.watch) return;
    this.remote.watch(this.basePath, (event, path) => {
      void this.handleRemoteEvent(event, path);
    });
  }

  private async handleRemoteEvent(
    event: WatchEventType,
    remotePath: string,
  ): Promise<void> {
    const localPath = this.localPath(remotePath);
    const localChange = this.local
      .getChanges()
      .find((change) => change.path === localPath);

    if (localChange) {
      const conflict = await this.checkRemoteEventConflict(
        localChange,
        remotePath,
        event,
      );
      if (conflict) {
        this.emit("conflict", conflict);
        if (conflict.resolved === "remote") {
          await this.applyRemoteEvent(event, localPath, remotePath);
          this.local.markSynced([localPath]);
          this.emit("change", {
            path: localPath,
            type: event,
            mtime: new Date(),
          });
        }
        return;
      }

      return;
    }

    try {
      await this.applyRemoteEvent(event, localPath, remotePath);
      this.emit("change", {
        path: localPath,
        type: event,
        mtime: new Date(),
      });
    } catch (err) {
      this.emit("error", err instanceof Error ? err : new Error(String(err)));
    }
  }

  private async checkConflict(
    change: ChangeRecord,
    remotePath: string,
  ): Promise<ConflictRecord | null> {
    try {
      const remoteStat = await this.remote.stat(remotePath);
      if (remoteStat.mtime <= change.mtime) return null;
      const checksums = await readChecksums(
        this.local,
        change.path,
        this.remote,
        remotePath,
      );
      return resolveConflict({
        path: change.path,
        changeMtime: change.mtime,
        remoteMtime: remoteStat.mtime,
        localChecksum: checksums.local,
        remoteChecksum: checksums.remote,
        strategy: this.conflictStrategy,
      });
    } catch {
      return null;
    }
  }

  private async checkRemoteEventConflict(
    change: ChangeRecord,
    remotePath: string,
    event: WatchEventType,
  ): Promise<ConflictRecord | null> {
    if (event === "delete") {
      if (change.type === "delete") return null;
      return resolveConflict({
        path: change.path,
        changeMtime: change.mtime,
        remoteMtime: new Date(),
        strategy: this.conflictStrategy,
      });
    }

    try {
      const remoteStat = await this.remote.stat(remotePath);
      if (remoteStat.mtime <= change.mtime) return null;
      const checksums = await readChecksums(
        this.local,
        change.path,
        this.remote,
        remotePath,
      );
      return resolveConflict({
        path: change.path,
        changeMtime: change.mtime,
        remoteMtime: remoteStat.mtime,
        localChecksum: checksums.local,
        remoteChecksum: checksums.remote,
        strategy: this.conflictStrategy,
      });
    } catch {
      return null;
    }
  }

  private async applyRemoteEvent(
    event: WatchEventType,
    localPath: string,
    remotePath: string,
  ): Promise<void> {
    if (event === "delete") {
      await this.local.applyRemoteDelete(localPath);
      return;
    }

    const content = await this.remote.readFile(remotePath);
    await this.local.applyRemoteFile(localPath, content);
  }
}
