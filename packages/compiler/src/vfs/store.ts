import type { StorageBackend, VirtualFile, VirtualProject } from './types.js';
import { resolveEntry } from './project.js';

export class VFSStore {
  constructor(private backend: StorageBackend, private root = '') {}

  private key(path: string): string {
    return this.root ? `${this.root}/${path}` : path;
  }

  async getFile(path: string): Promise<VirtualFile | null> {
    const content = await this.backend.get(this.key(path));
    if (!content) return null;
    return { path, content };
  }

  async putFile(file: VirtualFile): Promise<void> {
    await this.backend.put(this.key(file.path), file.content);
  }

  async deleteFile(path: string): Promise<void> {
    await this.backend.delete(this.key(path));
  }

  async listFiles(prefix?: string): Promise<string[]> {
    const fullPrefix = prefix ? this.key(prefix) : this.root;
    const paths = await this.backend.list(fullPrefix);
    return paths.map((p) => (this.root ? p.slice(this.root.length + 1) : p));
  }

  async loadProject(id: string): Promise<VirtualProject | null> {
    const paths = await this.listFiles(id);
    if (paths.length === 0) return null;

    const files = new Map<string, VirtualFile>();
    await Promise.all(
      paths.map(async (path) => {
        const file = await this.getFile(path);
        if (file) files.set(path.slice(id.length + 1), file);
      }),
    );

    return { id, entry: resolveEntry(files), files };
  }

  async saveProject(project: VirtualProject): Promise<void> {
    await Promise.all(
      Array.from(project.files.values()).map((file) =>
        this.putFile({ ...file, path: `${project.id}/${file.path}` }),
      ),
    );
  }
}
