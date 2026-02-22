# Patchwork Directory Sync

Patchwork now has a full virtual filesystem setup, where we can load files/directories and edit files individually, saving them to the remote store as-needed.

Extend this functionality, allowing for a generic implementation where we sync changes with remote sources (a local directory, later an S3 bucket...)

Generally, we want to maintain compatibility with Node-like FS operations, as we need a lot of functionality to run in the browser.

---

## Executive Summary

This document outlines a comprehensive plan to refactor Patchwork's virtual filesystem into a bidirectional sync system supporting multiple backends (local directories, S3, IndexedDB) with proper change tracking, conflict resolution, and event-based updates.

**Key Goals:**
- Unified `FSProvider` interface matching Node.js `fs/promises` semantics
- Bidirectional sync between in-memory state and remote backends
- Event-driven change propagation (watch capabilities)
- Clean separation between storage backends and sync logic
- Breaking changes acceptable; provide clear migration path

---

## Current Architecture

### Package Structure

```
packages/compiler/src/vfs/
├── backends/
│   ├── indexeddb.ts      # Browser storage
│   ├── local-fs.ts       # HTTP → stitchery server
│   └── s3.ts             # Direct S3 (no auth signing)
├── project.ts            # VirtualProject utilities
├── store.ts              # VFSStore class
└── types.ts              # Core interfaces
```

### Existing Interfaces

```typescript
// Current StorageBackend - flat key/value only
interface StorageBackend {
  get(path: string): Promise<string | null>;
  put(path: string, content: string): Promise<void>;
  delete(path: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
  exists(path: string): Promise<boolean>;
}

// Current VirtualFile - minimal metadata
interface VirtualFile {
  path: string;
  content: string;
  language?: string;
  note?: string;
  encoding?: 'utf8' | 'base64';
}

// Current VirtualProject - in-memory project state
interface VirtualProject {
  id: string;
  entry: string;
  files: Map<string, VirtualFile>;
}
```

### Current Data Flow

```
┌─────────────┐      ┌──────────────┐      ┌─────────────────┐
│   Browser   │ ───► │  VFSStore    │ ───► │ StorageBackend  │
│   (React)   │      │              │      │                 │
└─────────────┘      └──────────────┘      └─────────────────┘
                                                   │
                     ┌─────────────────────────────┼─────────────────────────────┐
                     │                             │                             │
              ┌──────▼──────┐             ┌────────▼────────┐           ┌────────▼────────┐
              │ IndexedDB   │             │   LocalFS       │           │      S3         │
              │  Backend    │             │   Backend       │           │    Backend      │
              └─────────────┘             └────────┬────────┘           └─────────────────┘
                                                   │ HTTP
                                          ┌────────▼────────┐
                                          │   Stitchery     │
                                          │  /vfs routes    │
                                          └────────┬────────┘
                                                   │
                                          ┌────────▼────────┐
                                          │  Local Disk     │
                                          │  (Node.js fs)   │
                                          └─────────────────┘
```

### Issues with Current Implementation

| Issue | Impact |
|-------|--------|
| Flat key-value semantics | No directory operations (mkdir, rmdir, readdir) |
| No change events | Cannot watch for external changes |
| Unidirectional sync | Only pushes; doesn't pull remote updates |
| No conflict resolution | Overwrites without checking |
| S3 backend incomplete | Missing AWS Signature V4 authentication |
| Metadata loss | File stats (mtime, size) not tracked |
| No atomic operations | Partial writes possible on failure |

---

## Proposed Architecture

### New Package Structure

```
packages/compiler/src/vfs/
├── core/
│   ├── types.ts          # FSProvider, SyncEngine interfaces
│   ├── fs-provider.ts    # Base FSProvider implementation
│   └── virtual-fs.ts     # In-memory FS with change tracking
├── sync/
│   ├── engine.ts         # Bidirectional sync orchestration
│   ├── differ.ts         # Change detection and diff generation
│   └── resolver.ts       # Conflict resolution strategies
├── backends/
│   ├── memory.ts         # In-memory (for tests/ephemeral)
│   ├── indexeddb.ts      # Browser IndexedDB
│   ├── http.ts           # Generic HTTP backend (replaces local-fs)
│   └── s3.ts             # AWS S3 with proper signing
├── project.ts            # VirtualProject utilities (preserved)
└── index.ts              # Public exports
```

### Core Interfaces

```typescript
/**
 * File statistics matching Node.js fs.Stats subset
 */
interface FileStats {
  size: number;
  mtime: Date;
  isFile(): boolean;
  isDirectory(): boolean;
}

/**
 * Directory entry matching Node.js fs.Dirent
 */
interface DirEntry {
  name: string;
  isFile(): boolean;
  isDirectory(): boolean;
}

/**
 * FSProvider - Node.js fs/promises compatible interface
 * All paths are relative to the provider's root.
 */
interface FSProvider {
  // File operations
  readFile(path: string, encoding?: 'utf8' | 'base64'): Promise<string>;
  writeFile(path: string, content: string, encoding?: 'utf8' | 'base64'): Promise<void>;
  unlink(path: string): Promise<void>;
  
  // Directory operations
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  rmdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  readdir(path: string): Promise<DirEntry[]>;
  
  // Metadata
  stat(path: string): Promise<FileStats>;
  exists(path: string): Promise<boolean>;
  
  // Watch (optional - backends may not support)
  watch?(path: string, callback: WatchCallback): () => void;
}

type WatchEventType = 'create' | 'update' | 'delete';
type WatchCallback = (event: WatchEventType, path: string) => void;

/**
 * Change record for sync operations
 */
interface ChangeRecord {
  path: string;
  type: 'create' | 'update' | 'delete';
  content?: string;
  mtime?: Date;
  checksum?: string;
}

/**
 * Conflict resolution strategy
 */
type ConflictStrategy = 
  | 'local-wins'      // Always use local version (default)
  | 'remote-wins'     // Always use remote version
  | 'newest-wins'     // Compare mtime
  | 'manual';         // Queue for user resolution

/**
 * SyncEngine - orchestrates bidirectional sync
 */
interface SyncEngine {
  /** Current sync status */
  readonly status: 'idle' | 'syncing' | 'error';
  
  /** Pending changes not yet synced */
  readonly pendingChanges: ChangeRecord[];
  
  /** Start continuous sync (if backend supports watch) */
  start(): Promise<void>;
  
  /** Stop continuous sync */
  stop(): Promise<void>;
  
  /** Force immediate sync */
  sync(): Promise<SyncResult>;
  
  /** Subscribe to sync events */
  on(event: 'change' | 'conflict' | 'error', callback: Function): () => void;
}

interface SyncResult {
  pushed: number;
  pulled: number;
  conflicts: ConflictRecord[];
}

interface ConflictRecord {
  path: string;
  local: ChangeRecord;
  remote: ChangeRecord;
  resolved?: 'local' | 'remote';
}
```

### Data Flow (Proposed)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              Browser                                     │
├─────────────────────────────────────────────────────────────────────────┤
│  ┌───────────────┐                                                       │
│  │   VFSStore    │  (preserved API, uses VirtualFS internally)          │
│  └───────┬───────┘                                                       │
│          │                                                               │
│  ┌───────▼───────┐      ┌──────────────┐      ┌────────────────┐        │
│  │   VirtualFS   │◄────►│  SyncEngine  │◄────►│   FSProvider   │        │
│  │  (in-memory)  │      │              │      │   (backend)    │        │
│  └───────────────┘      └──────────────┘      └───────┬────────┘        │
│                                                       │                  │
└───────────────────────────────────────────────────────┼──────────────────┘
                                                        │
        ┌───────────────────────────────────────────────┼───────────────────────────────────┐
        │                                               │                                   │
┌───────▼───────┐                              ┌────────▼────────┐               ┌──────────▼──────────┐
│  IndexedDB    │                              │   HTTP Backend  │               │    S3 Backend       │
│   Backend     │                              │                 │               │  (signed requests)  │
└───────────────┘                              └────────┬────────┘               └─────────────────────┘
                                                        │
                                               ┌────────▼────────┐
                                               │   Stitchery     │
                                               │  /vfs routes    │
                                               └────────┬────────┘
                                                        │
                                               ┌────────▼────────┐
                                               │  Local Disk     │
                                               └─────────────────┘
```

---

## Breaking Changes

### Removed/Renamed

| Old | New | Migration |
|-----|-----|-----------|
| `StorageBackend` | `FSProvider` | Implement new interface methods |
| `LocalFSBackend` | `HttpBackend` | Rename import, update config |
| `VFSStore.getFile()` | `VFSStore.readFile()` | Update call sites |
| `VFSStore.putFile()` | `VFSStore.writeFile()` | Update call sites |

### New Required Methods

Backends must implement these additional methods:

```typescript
// Old interface (5 methods)
interface StorageBackend {
  get, put, delete, list, exists
}

// New interface (10 methods)
interface FSProvider {
  readFile, writeFile, unlink,          // File ops
  mkdir, rmdir, readdir,                 // Directory ops
  stat, exists,                          // Metadata
  watch?                                 // Optional
}
```

### VFSStore API Changes

```typescript
// BEFORE
const store = new VFSStore(backend);
const file = await store.getFile('path');
await store.putFile({ path: 'x', content: 'y' });

// AFTER
const store = new VFSStore(provider, { sync: true });
const content = await store.readFile('path');
await store.writeFile('x', 'y');

// New capabilities
store.on('change', (path, type) => console.log(path, type));
await store.sync();  // Force sync
```

---

## Implementation Phases

## Current Status (Feb 22, 2026)

- Phase 1 complete: `FSProvider` types, `VirtualFS`, and `MemoryBackend` are in place.
- Phase 2 complete: stitchery `/vfs` routes support `stat`, `mkdir`, `readdir`, `rmdir`, and `watch`; `HttpBackend` aligns with the new interface.
- Phase 3 complete: `SyncEngine` handles push/pull, mtime-based conflict detection, remote watch events, and checksum-based conflict resolution via `differ.ts` and `resolver.ts`.
- Phase 4 complete: IndexedDB backend supports directory semantics and `stat` metadata.
- Phase 5 not started: S3 backend/signing is removed and needs a full re-implementation.
- Phase 6 complete: chat editor VFS sync + change listeners wired; zolvery types deduplicated to use compiler exports.
- Tests: new unit/integration coverage for FSProvider and sync engine is still pending.

### Phase 1: Core Interfaces & In-Memory Backend (1-2 days)

**Goal:** Establish new type system, implement VirtualFS with change tracking.

1. Create `FSProvider` interface in `core/types.ts`
2. Implement `VirtualFS` class (in-memory FSProvider with events)
3. Add `ChangeTracker` for recording modifications
4. Write tests for basic FS operations

**Deliverables:**
- `packages/compiler/src/vfs/core/types.ts`
- `packages/compiler/src/vfs/core/virtual-fs.ts`
- `packages/compiler/src/vfs/backends/memory.ts`

### Phase 2: HTTP Backend Upgrade (1 day)

**Goal:** Upgrade stitchery VFS routes and HTTP backend to support full FSProvider interface.

1. Add directory operations to stitchery `/vfs` routes:
   - `POST /vfs?mkdir=path` - Create directory
   - `DELETE /vfs/path?recursive=true` - Remove directory
   - `GET /vfs/path?stat=true` - Get file stats
2. Update `HttpBackend` to implement `FSProvider`
3. Add SSE endpoint for watch: `GET /vfs?watch=path`

**Deliverables:**
- Updated `packages/stitchery/src/server/vfs-routes.ts`
- New `packages/compiler/src/vfs/backends/http.ts`

### Phase 3: SyncEngine Implementation (2-3 days)

**Goal:** Build bidirectional sync with conflict handling.

1. Implement `SyncEngine` class with:
   - Change diffing (checksum-based)
   - Push/pull orchestration
   - Conflict detection
2. Add conflict resolution strategies (`local-wins` default)
3. Integrate with `VFSStore`

**Deliverables:**
- `packages/compiler/src/vfs/sync/engine.ts`
- `packages/compiler/src/vfs/sync/differ.ts`
- `packages/compiler/src/vfs/sync/resolver.ts`

### Phase 4: IndexedDB Backend Upgrade (1 day)

**Goal:** Add directory semantics to browser storage.

1. Implement virtual directory structure over flat IDB
2. Add `stat` metadata storage
3. Maintain backwards compatibility with existing stored data

**Deliverables:**
- Updated `packages/compiler/src/vfs/backends/indexeddb.ts`

### Phase 5: S3 Backend with Auth (1-2 days)

**Goal:** Production-ready S3 storage with AWS Signature V4.

1. Implement AWS Signature V4 signing
2. Add presigned URL support for browser-direct uploads
3. Implement `watch` via S3 Events → WebSocket (optional)

**Deliverables:**
- Updated `packages/compiler/src/vfs/backends/s3.ts`

### Phase 6: Client Migration (1-2 days)

**Goal:** Update Patchwork apps (chat, zolvery) and document migration for other clients.

1. Update `@aprovan/patchwork-editor` VFS utilities
2. Update chat app to use new APIs
3. Update zolvery app to use new APIs
4. Write migration guide

---

## Chat App Migration Guide

### Step 1: Update VFS Imports

```typescript
// BEFORE (packages/editor/src/lib/vfs.ts)
import { 
  VFSStore, 
  LocalFSBackend, 
  type VirtualProject,
  type VirtualFile 
} from '@aprovan/patchwork-compiler';

// AFTER
import { 
  VFSStore,
  HttpBackend,
  type VirtualProject,
  type VirtualFile 
} from '@aprovan/patchwork-compiler';
```

### Step 2: Update Store Initialization

```typescript
// BEFORE
export function getVFSStore(): VFSStore {
  if (!storeInstance) {
    const backend = new LocalFSBackend({ baseUrl: VFS_BASE_URL });
    storeInstance = new VFSStore(backend);
  }
  return storeInstance;
}

// AFTER
export function getVFSStore(): VFSStore {
  if (!storeInstance) {
    const provider = new HttpBackend({ baseUrl: VFS_BASE_URL });
    storeInstance = new VFSStore(provider, {
      sync: true,  // Enable auto-sync
      conflictStrategy: 'local-wins'
    });
  }
  return storeInstance;
}
```

### Step 3: Update File Operations

```typescript
// BEFORE
export async function saveFile(file: VirtualFile): Promise<void> {
  const store = getVFSStore();
  await store.putFile(file);
}

// AFTER
export async function saveFile(path: string, content: string): Promise<void> {
  const store = getVFSStore();
  await store.writeFile(path, content);
}
```

### Step 4: Add Change Listeners (Optional)

```typescript
// New capability - react to external changes
export function subscribeToChanges(
  callback: (path: string, type: 'create' | 'update' | 'delete') => void
): () => void {
  const store = getVFSStore();
  return store.on('change', callback);
}
```

### Step 5: Update CodePreview Save Logic

```typescript
// In CodePreview.tsx
// BEFORE
const handleSave = useCallback(async () => {
  setSaveStatus('saving');
  try {
    const project = createSingleFileProject(currentCode, entryFile, projectId);
    await saveProject(project);
    setSaveStatus('saved');
  } catch { ... }
}, [...]);

// AFTER
const handleSave = useCallback(async () => {
  setSaveStatus('saving');
  try {
    const path = `${projectId}/${entryFile}`;
    await saveFile(path, currentCode);
    setSaveStatus('saved');
  } catch { ... }
}, [...]);
```

---

## Zolvery App Migration Guide

### Step 1: Update VFS Imports

```typescript
// BEFORE
import { 
  VFSStore, 
  LocalFSBackend,
  type VirtualProject
} from '@aprovan/patchwork-compiler';

// AFTER
import { 
  VFSStore,
  HttpBackend,
  type VirtualProject
} from '@aprovan/patchwork-compiler';
```

### Step 2: Initialize Store with Sync

```typescript
// BEFORE
const backend = new LocalFSBackend({ baseUrl: VFS_BASE_URL });
const store = new VFSStore(backend);

// AFTER
const provider = new HttpBackend({ baseUrl: VFS_BASE_URL });
const store = new VFSStore(provider, {
  sync: true,
  conflictStrategy: 'local-wins'
});
```

### Step 3: Replace File APIs

```typescript
// BEFORE
await store.putFile({ path, content });
const file = await store.getFile(path);

// AFTER
await store.writeFile(path, content);
const content = await store.readFile(path);
```

### Step 4: Update Project Save/Load Helpers

```typescript
// BEFORE
export async function saveProject(project: VirtualProject) {
  await store.putProject(project);
}

// AFTER
export async function saveProject(project: VirtualProject) {
  await store.writeProject(project);
}
```

---

## Stitchery Server Upgrade

### New VFS Routes

```typescript
// packages/stitchery/src/server/vfs-routes.ts

// Existing routes (unchanged)
GET  /vfs                    → List all files
GET  /vfs/:path              → Read file content
PUT  /vfs/:path              → Write file content
DELETE /vfs/:path            → Delete file

// New routes
GET  /vfs/:path?stat=true    → Get file/dir stats
POST /vfs/:path?mkdir=true   → Create directory
DELETE /vfs/:path?recursive=true → Delete directory recursively
GET  /vfs?watch=:path        → SSE stream for file changes

// Stats response
{
  "size": 1234,
  "mtime": "2024-01-15T12:00:00Z",
  "isFile": true,
  "isDirectory": false
}

// Watch event format (SSE)
event: change
data: {"type":"update","path":"project/file.tsx","mtime":"..."}
```

### Route Behavior Details

- Paths are always relative to the VFS root. Normalize `.` and `..` and reject escaping the root.
- `readdir` returns only direct children, sorted lexicographically, excluding `.` and `..`.
- `stat` returns `isFile` and `isDirectory` based on the underlying FS entry, not inferred from content.
- `mkdir` supports `recursive=true` and is idempotent for existing directories.
- `rmdir` with `recursive=true` removes all descendants; without it, fails on non-empty directories.
- `unlink` returns 404 for missing paths and 409 when attempting to delete a directory without `recursive=true`.
- `watch` streams `create`, `update`, and `delete` events, with a root-relative `path` and RFC3339 `mtime`.

### Error Mapping

- 400: Invalid query params or unsupported operation
- 404: Path not found
- 409: Directory not empty or type mismatch
- 500: Unhandled server error

### Watch Implementation

```typescript
// Simple watch using fs.watch (Node.js)
import { watch } from 'node:fs';

const watchers = new Map<string, Set<ServerResponse>>();

export function handleVFSWatch(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: VFSContext
): void {
  const query = new URL(req.url!, 'http://localhost').searchParams;
  const watchPath = query.get('watch');
  
  if (!watchPath) return;
  
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  const fullPath = join(ctx.rootDir, watchPath);
  
  const watcher = watch(fullPath, { recursive: true }, (event, filename) => {
    const data = JSON.stringify({
      type: event === 'rename' ? 'create' : 'update',
      path: filename,
      mtime: new Date().toISOString()
    });
    res.write(`event: change\ndata: ${data}\n\n`);
  });
  
  req.on('close', () => watcher.close());
}
```

---

## Testing Strategy

### Unit Tests

```typescript
// Test FSProvider implementations
describe('FSProvider', () => {
  const providers = [
    ['Memory', () => new MemoryBackend()],
    ['IndexedDB', () => new IndexedDBBackend()],
    ['HTTP', () => new HttpBackend({ baseUrl: 'http://test' })]
  ];
  
  test.each(providers)('%s: readFile/writeFile', async (_, create) => {
    const fs = create();
    await fs.writeFile('test.txt', 'hello');
    expect(await fs.readFile('test.txt')).toBe('hello');
  });
  
  test.each(providers)('%s: mkdir/readdir', async (_, create) => {
    const fs = create();
    await fs.mkdir('dir', { recursive: true });
    await fs.writeFile('dir/file.txt', 'content');
    const entries = await fs.readdir('dir');
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('file.txt');
  });
});
```

### Integration Tests

```typescript
// Test sync engine with mock backends
describe('SyncEngine', () => {
  test('pushes local changes to remote', async () => {
    const local = new MemoryBackend();
    const remote = new MemoryBackend();
    const sync = new SyncEngine(local, remote);
    
    await local.writeFile('new.txt', 'content');
    const result = await sync.sync();
    
    expect(result.pushed).toBe(1);
    expect(await remote.readFile('new.txt')).toBe('content');
  });
  
  test('pulls remote changes to local', async () => { ... });
  test('detects conflicts', async () => { ... });
});
```

---

## Open Questions

1. **Conflict UI**: How should conflicts be displayed?
   - *Recommendation:* Default to `local-wins` for simplicity. Patchwork is local-first.

2. **Watch granularity**: Watch entire VFS root, or per-project?
   - *Recommendation:* Per-project for performance; add `store.watch(projectId)`

3. **Binary files**: Current system is text-only. Support binary?
   - *Recommendation:* Treat binary files as remote references. Store locally for viewing, override on save (no conflict resolution for binary)

4. **Offline support**: Queue changes when offline?
   - *Recommendation:* Defer for now. Keep abstractions clean for future implementation, but no built-in support yet.

---

## Timeline Estimate

| Phase | Duration | Dependencies |
|-------|----------|--------------|
| 1. Core Interfaces | 1-2 days | None |
| 2. HTTP Backend | 1 day | Phase 1 |
| 3. SyncEngine | 2-3 days | Phase 1, 2 |
| 4. IndexedDB Upgrade | 1 day | Phase 1 |
| 5. S3 Backend | 1-2 days | Phase 1 |
| 6. Client Migration | 1-2 days | Phase 2, 3 |

**Total: 7-11 days**

---

## Appendix: Full Interface Definitions

```typescript
// packages/compiler/src/vfs/core/types.ts

export interface FileStats {
  size: number;
  mtime: Date;
  isFile(): boolean;
  isDirectory(): boolean;
}

export interface DirEntry {
  name: string;
  isFile(): boolean;
  isDirectory(): boolean;
}

export type WatchEventType = 'create' | 'update' | 'delete';
export type WatchCallback = (event: WatchEventType, path: string) => void;

export interface FSProvider {
  readFile(path: string, encoding?: 'utf8' | 'base64'): Promise<string>;
  writeFile(path: string, content: string, encoding?: 'utf8' | 'base64'): Promise<void>;
  unlink(path: string): Promise<void>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  rmdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  readdir(path: string): Promise<DirEntry[]>;
  stat(path: string): Promise<FileStats>;
  exists(path: string): Promise<boolean>;
  watch?(path: string, callback: WatchCallback): () => void;
}

export interface ChangeRecord {
  path: string;
  type: WatchEventType;
  content?: string;
  mtime?: Date;
  checksum?: string;
}

export type ConflictStrategy = 'local-wins' | 'remote-wins' | 'newest-wins' | 'manual';

export interface SyncOptions {
  conflictStrategy?: ConflictStrategy;
  autoSync?: boolean;
  syncInterval?: number;
}

export interface SyncResult {
  pushed: number;
  pulled: number;
  conflicts: ConflictRecord[];
}

export interface ConflictRecord {
  path: string;
  local: ChangeRecord;
  remote: ChangeRecord;
  resolved?: 'local' | 'remote';
}

export interface SyncEngine {
  readonly status: 'idle' | 'syncing' | 'error';
  readonly pendingChanges: ChangeRecord[];
  start(): Promise<void>;
  stop(): Promise<void>;
  sync(): Promise<SyncResult>;
  on(event: 'change', callback: (path: string, type: WatchEventType) => void): () => void;
  on(event: 'conflict', callback: (conflict: ConflictRecord) => void): () => void;
  on(event: 'error', callback: (error: Error) => void): () => void;
}
```
