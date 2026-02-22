/**
 * File statistics matching Node.js fs.Stats subset
 */
export interface FileStats {
  size: number;
  mtime: Date;
  isFile(): boolean;
  isDirectory(): boolean;
}

/**
 * Directory entry matching Node.js fs.Dirent
 */
export interface DirEntry {
  name: string;
  isFile(): boolean;
  isDirectory(): boolean;
}

export type WatchEventType = "create" | "update" | "delete";
export type WatchCallback = (event: WatchEventType, path: string) => void;

/**
 * FSProvider - Node.js fs/promises compatible interface
 * All paths are relative to provider root
 */
export interface FSProvider {
  readFile(path: string, encoding?: "utf8" | "base64"): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  unlink(path: string): Promise<void>;
  stat(path: string): Promise<FileStats>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  readdir(path: string): Promise<DirEntry[]>;
  rmdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  exists(path: string): Promise<boolean>;
  watch?(path: string, callback: WatchCallback): () => void;
}

/**
 * Change record for sync operations
 */
export interface ChangeRecord {
  path: string;
  type: WatchEventType;
  mtime: Date;
  checksum?: string;
}

export type ConflictStrategy =
  | "local-wins"
  | "remote-wins"
  | "newest-wins"
  | "manual";

export interface SyncResult {
  pushed: number;
  pulled: number;
  conflicts: ConflictRecord[];
}

export interface ConflictRecord {
  path: string;
  localMtime: Date;
  remoteMtime: Date;
  resolved?: "local" | "remote";
}

export type SyncStatus = "idle" | "syncing" | "error";

export type SyncEventType = "change" | "conflict" | "error" | "status";
export type SyncEventCallback<T = unknown> = (data: T) => void;

/**
 * SyncEngine - orchestrates bidirectional sync
 */
export interface SyncEngine {
  status: SyncStatus;
  sync(): Promise<SyncResult>;
  startAutoSync(intervalMs: number): void;
  stopAutoSync(): void;
  on<T extends SyncEventType>(
    event: T,
    callback: SyncEventCallback<
      T extends "change"
        ? ChangeRecord
        : T extends "conflict"
        ? ConflictRecord
        : T extends "error"
        ? Error
        : SyncStatus
    >,
  ): () => void;
}
