// Core types and utilities
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
} from "./core/index.js";

export {
  basename,
  createDirEntry,
  createFileStats,
  dirname,
  join,
  normalizePath,
  VirtualFS,
} from "./core/index.js";

// Sync engine
export { SyncEngineImpl, type SyncEngineConfig } from "./sync/index.js";

// Backends
export { MemoryBackend } from "./backends/memory.js";
export { IndexedDBBackend } from "./backends/indexeddb.js";
export { HttpBackend, type HttpBackendConfig } from "./backends/http.js";

export type { VirtualFile, VirtualProject } from "./types.js";
export {
  createProjectFromFiles,
  createSingleFileProject,
  resolveEntry,
  detectMainFile,
} from "./project.js";
export { VFSStore, type VFSStoreOptions } from "./store.js";
