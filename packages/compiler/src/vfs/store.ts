import type {
  ChangeRecord,
  ConflictRecord,
  ConflictStrategy,
  DirEntry,
  FileStats,
  FSProvider,
  SyncEventCallback,
  SyncEventType,
  SyncResult,
  SyncStatus,
  WatchCallback,
} from "./core/types.js";
import { join } from "./core/utils.js";
import { VirtualFS } from "./core/virtual-fs.js";
import { SyncEngineImpl } from "./sync/index.js";
import type { VirtualFile, VirtualProject } from "./types.js";
import { resolveEntry } from "./project.js";

export interface VFSStoreOptions {
  root?: string;
  sync?: boolean;
  conflictStrategy?: ConflictStrategy;
  autoSyncIntervalMs?: number;
}

export class VFSStore {
  private local?: VirtualFS;
  private syncEngine?: SyncEngineImpl;
  private root: string;

  constructor(private provider: FSProvider, options: VFSStoreOptions = {}) {
    this.root = options.root ?? "";

    if (options.sync) {
      this.local = new VirtualFS();
      this.syncEngine = new SyncEngineImpl(this.local, this.provider, {
        conflictStrategy: options.conflictStrategy,
        basePath: this.root,
      });
      if (options.autoSyncIntervalMs) {
        this.syncEngine.startAutoSync(options.autoSyncIntervalMs);
      }
    }
  }

  async readFile(path: string, encoding?: "utf8" | "base64"): Promise<string> {
    if (this.local) {
      try {
        return await this.local.readFile(path, encoding);
      } catch {
        const content = await this.provider.readFile(
          this.remotePath(path),
          encoding,
        );
        await this.local.applyRemoteFile(path, content);
        return content;
      }
    }
    return this.provider.readFile(this.remotePath(path), encoding);
  }

  async writeFile(path: string, content: string): Promise<void> {
    if (this.local) {
      await this.local.writeFile(path, content);
      return;
    }
    await this.provider.writeFile(this.remotePath(path), content);
  }

  async unlink(path: string): Promise<void> {
    if (this.local) {
      await this.local.unlink(path);
      return;
    }
    await this.provider.unlink(this.remotePath(path));
  }

  async stat(path: string): Promise<FileStats> {
    if (this.local) {
      try {
        return await this.local.stat(path);
      } catch {
        return this.provider.stat(this.remotePath(path));
      }
    }
    return this.provider.stat(this.remotePath(path));
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    if (this.local) {
      await this.local.mkdir(path, options);
    }
    await this.provider.mkdir(this.remotePath(path), options);
  }

  async readdir(path: string): Promise<DirEntry[]> {
    if (this.local) {
      try {
        return await this.local.readdir(path);
      } catch {
        return this.provider.readdir(this.remotePath(path));
      }
    }
    return this.provider.readdir(this.remotePath(path));
  }

  async rmdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    if (this.local) {
      await this.local.rmdir(path, options);
    }
    await this.provider.rmdir(this.remotePath(path), options);
  }

  async exists(path: string): Promise<boolean> {
    if (this.local) {
      if (await this.local.exists(path)) return true;
      return this.provider.exists(this.remotePath(path));
    }
    return this.provider.exists(this.remotePath(path));
  }

  async listFiles(prefix = ""): Promise<string[]> {
    return this.walkFiles(prefix);
  }

  async loadProject(id: string): Promise<VirtualProject | null> {
    const paths = await this.listFiles(id);
    if (paths.length === 0) return null;

    const files = new Map<string, VirtualFile>();
    await Promise.all(
      paths.map(async (path) => {
        const content = await this.provider.readFile(this.remotePath(path));
        const relative = path.slice(id.length + 1);
        files.set(relative, { path: relative, content });
        if (this.local) {
          await this.local.applyRemoteFile(path, content);
        }
      }),
    );

    return { id, entry: resolveEntry(files), files };
  }

  async saveProject(project: VirtualProject): Promise<void> {
    if (this.local) {
      await Promise.all(
        Array.from(project.files.values()).map((file) =>
          this.local!.writeFile(`${project.id}/${file.path}`, file.content),
        ),
      );
      await this.sync();
      return;
    }

    await Promise.all(
      Array.from(project.files.values()).map((file) =>
        this.provider.writeFile(
          this.remotePath(`${project.id}/${file.path}`),
          file.content,
        ),
      ),
    );
  }

  watch(path: string, callback: WatchCallback): () => void {
    if (this.provider.watch) {
      return this.provider.watch(this.remotePath(path), callback);
    }
    return () => {};
  }

  async sync(): Promise<SyncResult> {
    if (!this.syncEngine) {
      return { pushed: 0, pulled: 0, conflicts: [] };
    }
    return this.syncEngine.sync();
  }

  on<T extends SyncEventType>(
    event: T,
    callback: SyncEventCallback<
      T extends "change"
        ? ChangeRecord
        : T extends "conflict"
        ? ConflictRecord
        : T extends "error"
        ? Error
        : SyncStatus
    >,
  ): () => void {
    if (!this.syncEngine) return () => {};
    return this.syncEngine.on(event, callback as SyncEventCallback<unknown>);
  }

  private remotePath(path: string): string {
    return this.root ? join(this.root, path) : path;
  }

  private async walkFiles(prefix: string): Promise<string[]> {
    const results: string[] = [];
    const normalized = prefix ? prefix.replace(/^\/+/g, "") : "";

    let entries: DirEntry[] = [];
    try {
      entries = await this.provider.readdir(this.remotePath(normalized));
    } catch {
      return results;
    }

    for (const entry of entries) {
      const entryPath = normalized ? `${normalized}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        results.push(...(await this.walkFiles(entryPath)));
      } else {
        results.push(entryPath);
      }
    }

    return results;
  }
}
