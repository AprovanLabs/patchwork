import {
  VFSStore,
  HttpBackend,
  type ChangeRecord,
  type VirtualProject,
} from '@aprovan/patchwork-compiler';

/**
 * VFS client for persisting virtual projects via HTTP.
 * Uses HttpBackend which makes HTTP requests to /vfs routes.
 */

// VFS base URL - points to a backend server's /vfs routes
const VFS_BASE_URL = '/vfs';

// Cached VFS config
let vfsConfigCache: { usePaths: boolean } | null = null;

/**
 * Get VFS configuration from the server.
 * Caches the result for subsequent calls.
 */
export async function getVFSConfig(): Promise<{ usePaths: boolean }> {
  if (vfsConfigCache) return vfsConfigCache;
  
  try {
    const res = await fetch(`${VFS_BASE_URL}/config`);
    if (res.ok) {
      vfsConfigCache = await res.json();
      return vfsConfigCache!;
    }
  } catch {
    // Server not available, use default
  }
  
  return { usePaths: false };
}

// Create a singleton store instance for dev mode
let storeInstance: VFSStore | null = null;

/**
 * Get the VFS store instance (creates one if needed).
 */
export function getVFSStore(): VFSStore {
  if (!storeInstance) {
    const provider = new HttpBackend({ baseUrl: VFS_BASE_URL });
    storeInstance = new VFSStore(provider, {
      sync: true,
      conflictStrategy: 'local-wins',
    });
  }
  return storeInstance;
}

/**
 * Save a virtual project to disk via the VFS server.
 * Projects are saved under their ID in the VFS directory.
 */
export async function saveProject(project: VirtualProject): Promise<void> {
  const store = getVFSStore();
  await store.saveProject(project);
}

/**
 * Load a project from disk by ID.
 */
export async function loadProject(id: string): Promise<VirtualProject | null> {
  const store = getVFSStore();
  return store.loadProject(id);
}

/**
 * List all stored project IDs.
 */
export async function listProjects(): Promise<string[]> {
  const store = getVFSStore();
  const files = await store.listFiles();
  
  // Extract unique project IDs (first path segment)
  const projectIds = new Set<string>();
  for (const file of files) {
    const id = file.split('/')[0];
    if (id) projectIds.add(id);
  }
  
  return Array.from(projectIds);
}

/**
 * Save a single file to the VFS.
 */
export async function saveFile(path: string, content: string): Promise<void> {
  const store = getVFSStore();
  await store.writeFile(path, content);
}

export async function loadFile(
  path: string,
  encoding?: 'utf8' | 'base64',
): Promise<string> {
  const store = getVFSStore();
  return store.readFile(path, encoding);
}

export function subscribeToChanges(
  callback: (record: ChangeRecord) => void,
): () => void {
  const store = getVFSStore();
  return store.on('change', callback);
}

/**
 * Storage adapter widgets save to / reload from. `CodePreview` talks to the
 * VFS only through this interface so hosts can supply their own backend
 * (e.g. the patchwork web app's gateway workspace FS); the default
 * {@link httpWidgetVfs} keeps the dev-server `/vfs` behavior.
 */
export interface WidgetVfs {
  /** Whether fence `path` attributes map to real VFS paths (dir = project id). */
  usePaths(): Promise<boolean>;
  saveProject(project: VirtualProject): Promise<void>;
  readFile(path: string): Promise<string>;
  /** Watch for external changes. Returns unsubscribe. */
  subscribe(callback: (record: { path: string; type: string }) => void): () => void;
}

/** Default adapter: the dev server's HTTP `/vfs` routes. */
export const httpWidgetVfs: WidgetVfs = {
  usePaths: async () => (await getVFSConfig()).usePaths,
  saveProject,
  readFile: (path) => loadFile(path),
  subscribe: (callback) => subscribeToChanges(callback),
};

/**
 * Check if VFS is available (backend server has /vfs routes enabled).
 */
export async function isVFSAvailable(): Promise<boolean> {
  try {
    const res = await fetch(VFS_BASE_URL, { method: 'HEAD' });
    return res.ok || res.status === 404; // 404 on root is expected if empty
  } catch {
    return false;
  }
}
