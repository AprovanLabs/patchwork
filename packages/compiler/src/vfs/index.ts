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
} from "./core/types.js";

export {
  basename,
  createDirEntry,
  createFileStats,
  dirname,
  join,
  normalizePath,
} from "./core/utils.js";

export { VirtualFS } from "./core/virtual-fs.js";

// Sync engine
export { SyncEngineImpl, type SyncEngineConfig } from "./sync/engine.js";
export { hashContent, readChecksum, readChecksums } from "./sync/differ.js";
export { resolveConflict, type ConflictResolutionInput } from "./sync/resolver.js";

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
