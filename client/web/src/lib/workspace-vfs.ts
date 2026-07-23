/**
 * Workspace filesystem for patchwork.
 *
 * A sync layer over two stores: the gateway's workspace FS (`/fs` routes —
 * the source of truth that follows the workspace across devices and agents)
 * and browser OPFS (offline cache + write-ahead store). When the gateway is
 * configured, every mutation lands in OPFS first (nothing is ever lost to a
 * dropped connection) and then write-through to the gateway; failures are
 * journaled and flushed on the next successful contact. Reads prefer the
 * gateway and fall back to the cache. Without a gateway, OPFS is simply the
 * store. Every exported helper is backend-agnostic so `ChatPage` never knows
 * which mode it's in.
 */

import {
  resolveEntry,
  type VirtualFile,
  type VirtualProject,
  type WatchCallback,
} from "@aprovan/patchwork-compiler";
import type { WidgetVfs } from "@aprovan/patchwork-editor";
import { GATEWAY_BASE } from "./gateway";
import { gatewayFetch } from "./gateway-fetch";

const watchers = new Set<WatchCallback>();
const normalize = (path: string) => path.replace(/^\/+|\/+$/g, "");
const split = (path: string) => normalize(path).split("/").filter(Boolean);

const MIME_BY_EXTENSION: Record<string, string> = {
  ts: "text/typescript",
  tsx: "text/typescript",
  js: "text/javascript",
  jsx: "text/javascript",
  json: "application/json",
  md: "text/markdown",
  css: "text/css",
  html: "text/html",
};

const mimeType = (path: string): string =>
  MIME_BY_EXTENSION[path.split(".").pop() ?? ""] ?? "text/plain";

export interface WorkspaceEntry {
  name: string;
  path: string;
  isDir: boolean;
}

interface WorkspaceBackend {
  /** Every file path, sorted, optionally under a prefix. */
  list(prefix?: string): Promise<string[]>;
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  /** Delete a file, or a whole subtree with recursive. */
  remove(path: string, recursive?: boolean): Promise<void>;
}

// ---------------------------------------------------------------------------
// OPFS backend (offline / unconfigured)
// ---------------------------------------------------------------------------

type IterableDirectoryHandle = FileSystemDirectoryHandle & {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
};

async function opfsDirectory(
  path: string,
  create = false,
): Promise<FileSystemDirectoryHandle> {
  let current = await navigator.storage.getDirectory();
  for (const part of split(path)) {
    current = await current.getDirectoryHandle(part, { create });
  }
  return current;
}

async function opfsList(
  handle?: FileSystemDirectoryHandle,
  prefix = "",
): Promise<string[]> {
  const current = handle ?? (await navigator.storage.getDirectory());
  const files: string[] = [];
  for await (const [name, entry] of (
    current as IterableDirectoryHandle
  ).entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (entry.kind === "directory") {
      files.push(...(await opfsList(entry as FileSystemDirectoryHandle, path)));
    } else {
      files.push(path);
    }
  }
  return files.sort();
}

const opfsBackend: WorkspaceBackend = {
  async list(prefix = "") {
    const all = await opfsList();
    const scope = normalize(prefix);
    return scope ? all.filter((p) => p === scope || p.startsWith(`${scope}/`)) : all;
  },
  async read(path) {
    const parts = split(path);
    const name = parts.pop();
    if (!name) throw new Error("File path is required");
    const handle = await (await opfsDirectory(parts.join("/"))).getFileHandle(name);
    return (await handle.getFile()).text();
  },
  async write(path, content) {
    const parts = split(path);
    const name = parts.pop();
    if (!name) throw new Error("File path is required");
    const handle = await (
      await opfsDirectory(parts.join("/"), true)
    ).getFileHandle(name, { create: true });
    const writer = await handle.createWritable();
    await writer.write(content);
    await writer.close();
  },
  async remove(path, recursive = false) {
    const parts = split(path);
    const name = parts.pop();
    if (!name) throw new Error("File path is required");
    await (await opfsDirectory(parts.join("/"))).removeEntry(name, { recursive });
  },
};

// ---------------------------------------------------------------------------
// Gateway backend (the workspace's real filesystem)
// ---------------------------------------------------------------------------

const gatewayBackend: WorkspaceBackend = {
  async list(prefix = "") {
    const query = prefix ? `?prefix=${encodeURIComponent(normalize(prefix))}` : "";
    const response = await gatewayFetch(`${GATEWAY_BASE}/fs${query}`);
    if (!response.ok) throw new Error(`fs list failed (${response.status})`);
    const { entries } = (await response.json()) as {
      entries: Array<{ path: string }>;
    };
    return entries.map((entry) => entry.path);
  },
  async read(path) {
    const response = await gatewayFetch(`${GATEWAY_BASE}/fs/${normalize(path)}`);
    if (!response.ok) throw new Error(`fs read failed (${response.status})`);
    return ((await response.json()) as { content: string }).content;
  },
  async write(path, content) {
    const response = await gatewayFetch(`${GATEWAY_BASE}/fs/${normalize(path)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, mimeType: mimeType(path) }),
    });
    if (!response.ok) throw new Error(`fs write failed (${response.status})`);
  },
  async remove(path, recursive = false) {
    const suffix = recursive ? "?recursive=1" : "";
    const response = await gatewayFetch(`${GATEWAY_BASE}/fs/${normalize(path)}${suffix}`, {
      method: "DELETE",
    });
    if (!response.ok) throw new Error(`fs delete failed (${response.status})`);
  },
};

// ---------------------------------------------------------------------------
// Offline journal
// ---------------------------------------------------------------------------

/**
 * Mutations that couldn't reach the gateway. Only the operation + path are
 * journaled — the content of a pending write is whatever OPFS holds for that
 * path at flush time, so repeated offline edits collapse into one upload.
 * Persisted in localStorage (OPFS itself holds the file bodies); like OPFS
 * it is origin-scoped, not workspace-scoped.
 */
interface PendingOp {
  op: "write" | "remove";
  path: string;
  recursive?: boolean;
}

const PENDING_KEY = "patchwork:wfs-pending";

function loadPending(): PendingOp[] {
  try {
    return JSON.parse(localStorage.getItem(PENDING_KEY) ?? "[]") as PendingOp[];
  } catch {
    return [];
  }
}

function savePending(entries: PendingOp[]): void {
  try {
    if (entries.length === 0) localStorage.removeItem(PENDING_KEY);
    else localStorage.setItem(PENDING_KEY, JSON.stringify(entries));
  } catch {
    // Journal persistence is best-effort; in-memory state still applies.
  }
}

let pending: PendingOp[] = loadPending();

function setPending(path: string, op: PendingOp): void {
  pending = [...pending.filter((entry) => entry.path !== path), op];
  savePending(pending);
}

function clearPending(path: string): void {
  if (!pending.some((entry) => entry.path === path)) return;
  pending = pending.filter((entry) => entry.path !== path);
  savePending(pending);
}

function hasPendingWrite(path: string): boolean {
  return pending.some((entry) => entry.op === "write" && entry.path === path);
}

let flushInFlight: Promise<void> | null = null;

/** Replay journaled mutations against the gateway; stops on first failure. */
function flushPending(): Promise<void> {
  if (pending.length === 0) return Promise.resolve();
  flushInFlight ??= (async () => {
    try {
      for (const entry of [...pending]) {
        if (entry.op === "write") {
          await gatewayBackend.write(entry.path, await opfsBackend.read(entry.path));
        } else {
          await gatewayBackend.remove(entry.path, entry.recursive);
        }
        clearPending(entry.path);
      }
    } catch {
      // Still offline (or a conflicting failure); retry on next contact.
    } finally {
      flushInFlight = null;
    }
  })();
  return flushInFlight;
}

/** A gateway op succeeded — good moment to drain the journal. */
function noteOnline(): void {
  if (pending.length > 0) void flushPending();
}

// ---------------------------------------------------------------------------
// Synced backend: OPFS cache + write-ahead, gateway source of truth
// ---------------------------------------------------------------------------

const syncedBackend: WorkspaceBackend = {
  async list(prefix = "") {
    try {
      const remote = await gatewayBackend.list(prefix);
      noteOnline();
      const scope = normalize(prefix);
      const inScope = (path: string) =>
        !scope || path === scope || path.startsWith(`${scope}/`);
      const removed = new Set(
        pending.filter((entry) => entry.op === "remove").map((entry) => entry.path),
      );
      const merged = new Set(
        remote.filter(
          (path) =>
            !removed.has(path) &&
            ![...removed].some((removedPath) => path.startsWith(`${removedPath}/`)),
        ),
      );
      for (const entry of pending) {
        if (entry.op === "write" && inScope(entry.path)) merged.add(entry.path);
      }
      return [...merged].sort();
    } catch {
      return opfsBackend.list(prefix);
    }
  },
  async read(path) {
    if (!hasPendingWrite(path)) {
      try {
        const content = await gatewayBackend.read(path);
        noteOnline();
        // Refresh the offline cache in the background.
        void opfsBackend.write(path, content).catch(() => {});
        return content;
      } catch {
        // Gateway unreachable or file gateway-side missing — serve the cache.
      }
    }
    return opfsBackend.read(path);
  },
  async write(path, content) {
    // Local-first: OPFS before the network, so a dropped connection never
    // loses an edit.
    await opfsBackend.write(path, content);
    try {
      await gatewayBackend.write(path, content);
      clearPending(path);
      noteOnline();
    } catch {
      setPending(path, { op: "write", path });
    }
  },
  async remove(path, recursive = false) {
    await opfsBackend.remove(path, recursive).catch(() => {});
    try {
      await gatewayBackend.remove(path, recursive);
      clearPending(path);
      noteOnline();
    } catch {
      setPending(path, { op: "remove", path, recursive });
    }
  },
};

// ---------------------------------------------------------------------------
// Backend selection
// ---------------------------------------------------------------------------

let backendPromise: Promise<WorkspaceBackend> | null = null;

/**
 * One-time OPFS → gateway migration. Files written before the gateway WFS
 * existed live only in browser OPFS; when the gateway becomes reachable and
 * the workspace tree is missing them, copy them up so nothing "disappears"
 * from the tree when the source of truth moves server-side.
 */
async function migrateOpfsToGateway(): Promise<void> {
  let localPaths: string[];
  try {
    localPaths = await opfsList();
  } catch {
    return; // No OPFS support — nothing to migrate.
  }
  if (localPaths.length === 0) return;
  const remotePaths = new Set(await gatewayBackend.list());
  const missing = localPaths.filter((path) => !remotePaths.has(path));
  await Promise.all(
    missing.map(async (path) => {
      try {
        await gatewayBackend.write(path, await opfsBackend.read(path));
      } catch {
        // Best-effort: an unreadable or rejected file shouldn't block the rest.
      }
    }),
  );
}

function backend(): Promise<WorkspaceBackend> {
  backendPromise ??= (async () => {
    if (!GATEWAY_BASE) return opfsBackend;
    try {
      const response = await gatewayFetch(`${GATEWAY_BASE}/fs`);
      if (response.ok) {
        await flushPending();
        await migrateOpfsToGateway();
        return syncedBackend;
      }
    } catch {
      // Gateway unreachable right now — the synced backend still serves the
      // OPFS cache and journals mutations until contact resumes.
    }
    return syncedBackend;
  })();
  return backendPromise;
}

/** Forget cached backend/session state (e.g. after a workspace switch). */
export function resetStore(): void {
  backendPromise = null;
}

// ---------------------------------------------------------------------------
// Shared helpers (backend-agnostic; the ChatPage surface)
// ---------------------------------------------------------------------------

export async function readFile(path: string): Promise<string> {
  return (await backend()).read(path);
}

async function writeFile(path: string, content: string): Promise<void> {
  await (await backend()).write(path, content);
  for (const watcher of watchers) watcher("update", normalize(path));
}

/**
 * Delete a workspace file or (with recursive) a whole directory subtree.
 * Watchers fire per removed path so open tabs close and trees refresh.
 */
export async function deleteWorkspacePath(
  path: string,
  options: { recursive?: boolean } = {},
): Promise<void> {
  const target = normalize(path);
  const store = await backend();
  const removed = options.recursive
    ? (await store.list(target)).filter((p) => p === target || p.startsWith(`${target}/`))
    : [target];
  await store.remove(target, options.recursive);
  for (const removedPath of removed.length > 0 ? removed : [target]) {
    for (const watcher of watchers) watcher("delete", removedPath);
  }
}

export function toWorkspaceTreeFiles(paths: string[]): VirtualFile[] {
  return paths.map((path) => ({ path, content: "" }));
}

/** Immediate children of a directory, derived from the flat path list. */
export async function listWorkspaceEntries(
  path = "",
): Promise<WorkspaceEntry[]> {
  const scope = normalize(path);
  const paths = await (await backend()).list(scope);
  const children = new Map<string, WorkspaceEntry>();
  for (const filePath of paths) {
    const relative = scope ? filePath.slice(scope.length + 1) : filePath;
    if (!relative) continue;
    const [head, ...rest] = relative.split("/");
    if (!head || children.has(head)) continue;
    children.set(head, {
      name: head,
      path: scope ? `${scope}/${head}` : head,
      isDir: rest.length > 0,
    });
  }
  return [...children.values()].sort(
    (left, right) =>
      Number(right.isDir) - Number(left.isDir) ||
      left.name.localeCompare(right.name),
  );
}

export async function listWorkspacePaths(): Promise<string[]> {
  return (await backend()).list();
}

export async function loadWorkspaceDirectoryProject(
  directoryPath: string,
): Promise<VirtualProject | null> {
  const prefix = normalize(directoryPath);
  const paths = await (await backend()).list(prefix);
  if (!paths.length) return null;
  const files = new Map<string, VirtualFile>();
  await Promise.all(
    paths.map(async (path) => {
      const relativePath = prefix ? path.slice(prefix.length + 1) : path;
      files.set(relativePath, {
        path: relativePath,
        content: await readFile(path),
      });
    }),
  );
  return { id: prefix, entry: resolveEntry(files), files };
}

export async function loadWorkspaceFileProject(
  filePath: string,
): Promise<VirtualProject | null> {
  const parts = split(filePath);
  const name = parts.pop();
  if (!name) return null;
  try {
    const content = await readFile(filePath);
    return {
      id: parts.join("/"),
      entry: name,
      files: new Map([[name, { path: name, content }]]),
    };
  } catch {
    return null;
  }
}

export function createSingleWorkspaceFileProject(
  filePath: string,
  content: string,
): VirtualProject {
  const parts = split(filePath);
  const name = parts.pop() ?? "main.tsx";
  return {
    id: parts.join("/"),
    entry: name,
    files: new Map([[name, { path: name, content }]]),
  };
}

export async function saveWorkspaceProject(
  project: VirtualProject,
): Promise<void> {
  await Promise.all(
    [...project.files.values()].map((file) =>
      writeFile(
        [normalize(project.id), normalize(file.path)].filter(Boolean).join("/"),
        file.content,
      ),
    ),
  );
}

export function subscribeToWorkspaceChanges(
  callback: WatchCallback,
): () => void {
  watchers.add(callback);
  return () => watchers.delete(callback);
}

/**
 * Widget storage adapter for `CodePreview`: saves land in the workspace FS
 * (gateway or OPFS) instead of the editor package's dev-only `/vfs` routes.
 */
export const workspaceWidgetVfs: WidgetVfs = {
  usePaths: async () => true,
  saveProject: saveWorkspaceProject,
  readFile,
  subscribe: (callback) =>
    subscribeToWorkspaceChanges((event, path) => callback({ path, type: event })),
};
