import { readFile, writeFile, unlink, stat, mkdir, readdir, rm, access } from "node:fs/promises";
import { join, dirname, normalize } from "node:path";
import type { DirEntry, FileStats, FSProvider } from "./types.js";

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

export class LocalFileBackend implements FSProvider {
  constructor(private basePath: string) {}

  private resolve(path: string): string {
    return join(this.basePath, normalize(path));
  }

  async readFile(path: string): Promise<string> {
    return readFile(this.resolve(path), "utf-8");
  }

  async writeFile(path: string, content: string): Promise<void> {
    const fullPath = this.resolve(path);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content, "utf-8");
  }

  async unlink(path: string): Promise<void> {
    await unlink(this.resolve(path));
  }

  async stat(path: string): Promise<FileStats> {
    const fullPath = this.resolve(path);
    const s = await stat(fullPath);
    return createFileStats(s.size, s.mtime, s.isDirectory());
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    await mkdir(this.resolve(path), options);
  }

  async readdir(path: string): Promise<DirEntry[]> {
    const fullPath = this.resolve(path);
    const entries = await readdir(fullPath, { withFileTypes: true });
    return entries.map((e) =>
      createDirEntry(e.name, e.isDirectory()),
    );
  }

  async rmdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    if (options?.recursive) {
      await rm(this.resolve(path), { recursive: true, force: true });
    } else {
      await rm(this.resolve(path), { force: true });
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      await access(this.resolve(path));
      return true;
    } catch {
      return false;
    }
  }
}
