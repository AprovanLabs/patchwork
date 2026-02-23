import {
  HttpBackend,
  VFSStore,
  resolveEntry,
  type VirtualFile,
  type VirtualProject,
  type WatchCallback,
} from '@aprovan/patchwork-compiler';

const VFS_BASE_URL = '/vfs';

let storeInstance: VFSStore | null = null;

function getStore(): VFSStore {
  if (!storeInstance) {
    const backend = new HttpBackend({ baseUrl: VFS_BASE_URL });
    storeInstance = new VFSStore(backend, {
      sync: false,
    });
  }
  return storeInstance;
}

function normalizePath(path: string): string {
  return path.replace(/^\/+|\/+$/g, '');
}

function dirname(path: string): string {
  const normalized = normalizePath(path);
  if (!normalized || !normalized.includes('/')) return '';
  return normalized.split('/').slice(0, -1).join('/');
}

function basename(path: string): string {
  const normalized = normalizePath(path);
  if (!normalized) return '';
  const parts = normalized.split('/');
  return parts[parts.length - 1] ?? '';
}

function joinPath(base: string, path: string): string {
  const normalizedBase = normalizePath(base);
  const normalizedPath = normalizePath(path);
  if (!normalizedBase) return normalizedPath;
  if (!normalizedPath) return normalizedBase;
  return `${normalizedBase}/${normalizedPath}`;
}

function toPrefix(path: string): string {
  const normalized = normalizePath(path);
  return normalized ? `${normalized}/` : '';
}

export function toWorkspaceTreeFiles(paths: string[]): VirtualFile[] {
  return paths.map((path) => ({ path, content: '' }));
}

function toProjectRelativePath(projectId: string, absolutePath: string): string {
  if (!projectId) return normalizePath(absolutePath);
  const normalizedProjectId = normalizePath(projectId);
  const normalizedPath = normalizePath(absolutePath);
  const prefix = `${normalizedProjectId}/`;
  if (normalizedPath.startsWith(prefix)) {
    return normalizedPath.slice(prefix.length);
  }
  return normalizedPath;
}

function toWorkspacePath(projectId: string, relativePath: string): string {
  const normalizedProjectId = normalizePath(projectId);
  const normalizedRelativePath = normalizePath(relativePath);
  if (!normalizedProjectId) return normalizedRelativePath;
  return joinPath(normalizedProjectId, normalizedRelativePath);
}

export interface WorkspaceEntry {
  name: string;
  path: string;
  isDir: boolean;
}

export async function listWorkspaceEntries(path = ''): Promise<WorkspaceEntry[]> {
  const store = getStore();
  const normalized = normalizePath(path);
  const entries = await store.readdir(normalized);

  return entries
    .map((entry) => ({
      name: entry.name,
      path: normalized ? `${normalized}/${entry.name}` : entry.name,
      isDir: entry.isDirectory(),
    }))
    .sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

export async function listWorkspacePaths(): Promise<string[]> {
  return getStore().listFiles();
}

export async function loadWorkspaceDirectoryProject(
  directoryPath: string,
): Promise<VirtualProject | null> {
  const store = getStore();
  const normalized = normalizePath(directoryPath);
  const prefix = toPrefix(normalized);
  const allPaths = await store.listFiles(normalized);
  const filePaths = allPaths.filter((path) =>
    prefix ? path.startsWith(prefix) : true,
  );

  if (filePaths.length === 0) {
    return null;
  }

  const files = new Map<string, VirtualFile>();
  await Promise.all(
    filePaths.map(async (path) => {
      const content = await store.readFile(path);
      const relativePath = toProjectRelativePath(normalized, path);
      files.set(relativePath, { path: relativePath, content });
    }),
  );

  return {
    id: normalized,
    entry: resolveEntry(files),
    files,
  };
}

export async function loadWorkspaceFileProject(
  filePath: string,
): Promise<VirtualProject | null> {
  const store = getStore();
  const normalized = normalizePath(filePath);
  const fileName = basename(normalized);
  const projectId = dirname(normalized);

  try {
    const content = await store.readFile(normalized);
    return {
      id: projectId,
      entry: fileName,
      files: new Map([[fileName, { path: fileName, content }]]),
    };
  } catch {
    return null;
  }
}

export function createSingleWorkspaceFileProject(
  filePath: string,
  content: string,
): VirtualProject {
  const normalized = normalizePath(filePath);
  const fileName = basename(normalized);
  const projectId = dirname(normalized);
  const files = new Map<string, VirtualFile>([
    [fileName, { path: fileName, content }],
  ]);

  return {
    id: projectId,
    entry: fileName,
    files,
  };
}

export async function saveWorkspaceProject(
  project: VirtualProject,
): Promise<void> {
  const store = getStore();
  await Promise.all(
    Array.from(project.files.values()).map((file) =>
      store.writeFile(toWorkspacePath(project.id, file.path), file.content),
    ),
  );
}

export function subscribeToWorkspaceChanges(callback: WatchCallback): () => void {
  return getStore().watch('', callback);
}
