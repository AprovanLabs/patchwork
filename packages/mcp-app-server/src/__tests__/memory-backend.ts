import type { DirEntry, FileStats, FSProvider } from "../widget-store/types.js";

function createDirEntry(name: string, isDir: boolean): DirEntry {
  return {
    name,
    isFile: () => !isDir,
    isDirectory: () => isDir,
  };
}

function createFileStats(size: number, mtime: Date, isDir: boolean): FileStats {
  return {
    size,
    mtime,
    isFile: () => !isDir,
    isDirectory: () => isDir,
  };
}

interface FileEntry {
  content: string;
  mtime: Date;
}

export class MemoryBackend implements FSProvider {
  private files = new Map<string, FileEntry>();
  private dirs = new Set<string>([""]);

  async readFile(path: string): Promise<string> {
    const normalized = path.replace(/^\/+|\/+$/g, "");
    const entry = this.files.get(normalized);
    if (!entry) throw new Error(`ENOENT: ${path}`);
    return entry.content;
  }

  async writeFile(path: string, content: string): Promise<void> {
    const normalized = path.replace(/^\/+|\/+$/g, "");
    const dir = normalized.split("/").slice(0, -1).join("/");
    if (dir && !this.dirs.has(dir)) {
      await this.mkdir(dir, { recursive: true });
    }
    this.files.set(normalized, { content, mtime: new Date() });
  }

  async unlink(path: string): Promise<void> {
    const normalized = path.replace(/^\/+|\/+$/g, "");
    if (!this.files.delete(normalized)) {
      throw new Error(`ENOENT: ${path}`);
    }
  }

  async stat(path: string): Promise<FileStats> {
    const normalized = path.replace(/^\/+|\/+$/g, "");
    const entry = this.files.get(normalized);
    if (entry) {
      return createFileStats(entry.content.length, entry.mtime, false);
    }
    if (this.dirs.has(normalized)) {
      return createFileStats(0, new Date(), true);
    }
    throw new Error(`ENOENT: ${path}`);
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    const normalized = path.replace(/^\/+|\/+$/g, "");
    if (this.dirs.has(normalized)) return;

    const parent = normalized.split("/").slice(0, -1).join("/");
    if (parent && !this.dirs.has(parent)) {
      if (options?.recursive) {
        await this.mkdir(parent, options);
      } else {
        throw new Error(`ENOENT: ${parent}`);
      }
    }
    this.dirs.add(normalized);
  }

  async readdir(path: string): Promise<DirEntry[]> {
    const normalized = path.replace(/^\/+|\/+$/g, "");
    if (!this.dirs.has(normalized)) {
      throw new Error(`ENOENT: ${path}`);
    }

    const prefix = normalized ? `${normalized}/` : "";
    const entries = new Map<string, boolean>();

    for (const filePath of this.files.keys()) {
      if (filePath.startsWith(prefix)) {
        const rest = filePath.slice(prefix.length);
        const name = rest.split("/")[0];
        if (name) entries.set(name, false);
      }
    }

    for (const dirPath of this.dirs) {
      if (dirPath.startsWith(prefix) && dirPath !== normalized) {
        const rest = dirPath.slice(prefix.length);
        const name = rest.split("/")[0];
        if (name) entries.set(name, true);
      }
    }

    return Array.from(entries).map(([name, isDir]) =>
      createDirEntry(name, isDir),
    );
  }

  async rmdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    const normalized = path.replace(/^\/+|\/+$/g, "");
    if (!this.dirs.has(normalized)) {
      throw new Error(`ENOENT: ${path}`);
    }

    const prefix = `${normalized}/`;
    const hasChildren =
      [...this.files.keys()].some((p) => p.startsWith(prefix)) ||
      [...this.dirs].some((d) => d.startsWith(prefix));

    if (hasChildren && !options?.recursive) {
      throw new Error(`ENOTEMPTY: ${path}`);
    }

    if (options?.recursive) {
      for (const filePath of [...this.files.keys()]) {
        if (filePath.startsWith(prefix)) {
          this.files.delete(filePath);
        }
      }
      for (const dirPath of [...this.dirs]) {
        if (dirPath.startsWith(prefix)) {
          this.dirs.delete(dirPath);
        }
      }
    }

    this.dirs.delete(normalized);
  }

  async exists(path: string): Promise<boolean> {
    const normalized = path.replace(/^\/+|\/+$/g, "");
    return this.files.has(normalized) || this.dirs.has(normalized);
  }
}
