export type { VirtualFile, VirtualProject, StorageBackend } from './types.js';
export {
  createProjectFromFiles,
  createSingleFileProject,
  resolveEntry,
  detectMainFile,
} from './project.js';
export { VFSStore } from './store.js';
export { IndexedDBBackend } from './backends/indexeddb.js';
export { LocalFSBackend, type LocalFSConfig } from './backends/local-fs.js';
export { S3Backend, type S3Config } from './backends/s3.js';
