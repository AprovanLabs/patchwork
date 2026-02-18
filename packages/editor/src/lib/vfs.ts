import { 
  VFSStore, 
  LocalFSBackend, 
  type VirtualProject,
  type VirtualFile 
} from '@aprovan/patchwork-compiler';

/**
 * VFS client for persisting virtual projects to the stitchery server.
 * Uses LocalFSBackend which makes HTTP requests to /vfs routes.
 */

// VFS base URL - points to stitchery server's VFS routes
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
 * Store uses LocalFSBackend to persist to the stitchery server.
 */
export function getVFSStore(): VFSStore {
  if (!storeInstance) {
    const backend = new LocalFSBackend({ baseUrl: VFS_BASE_URL });
    storeInstance = new VFSStore(backend);
  }
  return storeInstance;
}

/**
 * Save a virtual project to disk via the stitchery server.
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
export async function saveFile(file: VirtualFile): Promise<void> {
  const store = getVFSStore();
  await store.putFile(file);
}

/**
 * Check if VFS is available (stitchery server is running with vfs-dir enabled).
 */
export async function isVFSAvailable(): Promise<boolean> {
  try {
    const res = await fetch(VFS_BASE_URL, { method: 'HEAD' });
    return res.ok || res.status === 404; // 404 on root is expected if empty
  } catch {
    return false;
  }
}
