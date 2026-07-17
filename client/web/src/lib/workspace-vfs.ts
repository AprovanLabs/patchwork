/**
 * Workspace filesystem for patchwork.
 *
 * Two backends behind one interface: the gateway's workspace FS (`/fs`
 * routes — the source of truth that follows the workspace across devices and
 * agents) and browser OPFS (offline / unconfigured fallback). The backend is
 * probed once per page load; every exported helper is backend-agnostic so
 * `ChatPage` never knows which one it's talking to.
 */

import {
  resolveEntry,
  type VirtualFile,
  type VirtualProject,
  type WatchCallback,
} from "@aprovan/patchwork-compiler";
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
        await migrateOpfsToGateway();
        return gatewayBackend;
      }
    } catch {
      // Gateway unreachable — run local.
    }
    return opfsBackend;
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

async function readFile(path: string): Promise<string> {
  return (await backend()).read(path);
}

async function writeFile(path: string, content: string): Promise<void> {
  await (await backend()).write(path, content);
  for (const watcher of watchers) watcher("update", normalize(path));
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
