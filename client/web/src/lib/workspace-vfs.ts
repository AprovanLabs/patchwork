import {
  resolveEntry,
  type VirtualFile,
  type VirtualProject,
  type WatchCallback,
} from "@aprovan/patchwork-compiler";

const watchers = new Set<WatchCallback>();
const normalize = (path: string) => path.replace(/^\/+|\/+$/g, "");
const split = (path: string) => normalize(path).split("/").filter(Boolean);
type IterableDirectoryHandle = FileSystemDirectoryHandle & {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
};

async function root(): Promise<FileSystemDirectoryHandle> {
  return navigator.storage.getDirectory();
}

async function directory(
  path: string,
  create = false,
): Promise<FileSystemDirectoryHandle> {
  let current = await root();
  for (const part of split(path)) {
    current = await current.getDirectoryHandle(part, { create });
  }
  return current;
}

async function readFile(path: string): Promise<string> {
  const parts = split(path);
  const name = parts.pop();
  if (!name) throw new Error("File path is required");
  const handle = await (await directory(parts.join("/"))).getFileHandle(name);
  return (await handle.getFile()).text();
}

async function writeFile(path: string, content: string): Promise<void> {
  const parts = split(path);
  const name = parts.pop();
  if (!name) throw new Error("File path is required");
  const handle = await (
    await directory(parts.join("/"), true)
  ).getFileHandle(name, { create: true });
  const writer = await handle.createWritable();
  await writer.write(content);
  await writer.close();
  for (const watcher of watchers) watcher("update", normalize(path));
}

async function listFiles(
  handle?: FileSystemDirectoryHandle,
  prefix = "",
): Promise<string[]> {
  const current = handle ?? (await root());
  const files: string[] = [];
  for await (const [name, entry] of (
    current as IterableDirectoryHandle
  ).entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (entry.kind === "directory") {
      files.push(
        ...(await listFiles(entry as FileSystemDirectoryHandle, path)),
      );
    } else {
      files.push(path);
    }
  }
  return files.sort();
}

export interface WorkspaceEntry {
  name: string;
  path: string;
  isDir: boolean;
}

export function resetStore(): void {}

export function toWorkspaceTreeFiles(paths: string[]): VirtualFile[] {
  return paths.map((path) => ({ path, content: "" }));
}

export async function listWorkspaceEntries(
  path = "",
): Promise<WorkspaceEntry[]> {
  const handle = await directory(path);
  const entries: WorkspaceEntry[] = [];
  for await (const [name, entry] of (
    handle as IterableDirectoryHandle
  ).entries()) {
    entries.push({
      name,
      path: normalize(path) ? `${normalize(path)}/${name}` : name,
      isDir: entry.kind === "directory",
    });
  }
  return entries.sort(
    (left, right) =>
      Number(right.isDir) - Number(left.isDir) ||
      left.name.localeCompare(right.name),
  );
}

export function listWorkspacePaths(): Promise<string[]> {
  return listFiles();
}

export async function loadWorkspaceDirectoryProject(
  directoryPath: string,
): Promise<VirtualProject | null> {
  const prefix = normalize(directoryPath);
  const paths = (await listFiles()).filter((path) =>
    prefix ? path.startsWith(`${prefix}/`) : true,
  );
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
