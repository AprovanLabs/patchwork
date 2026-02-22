export type {
  ChangeRecord,
  ConflictRecord,
  ConflictStrategy,
  DirEntry,
  FileStats,
  FSProvider,
  SyncEngine,
  SyncEventCallback,
  SyncEventType,
  SyncResult,
  SyncStatus,
  WatchCallback,
  WatchEventType,
} from "./types.js";

export {
  basename,
  createDirEntry,
  createFileStats,
  dirname,
  join,
  normalizePath,
} from "./utils.js";

export { VirtualFS } from "./virtual-fs.js";
