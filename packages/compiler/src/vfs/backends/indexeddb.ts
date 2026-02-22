import type { DirEntry, FileStats, FSProvider } from "../core/types.js";
import {
  basename,
  createDirEntry,
  createFileStats,
  dirname,
  normalizePath,
} from "../core/utils.js";

const DB_NAME = "patchwork-vfs";
const DB_VERSION = 2;
const FILES_STORE = "files";
const DIRS_STORE = "dirs";

interface FileRecord {
  content: string;
  mtime: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (!db.objectStoreNames.contains(FILES_STORE)) {
        db.createObjectStore(FILES_STORE);
      }
      if (!db.objectStoreNames.contains(DIRS_STORE)) {
        db.createObjectStore(DIRS_STORE);
      }
    };
  });
}

function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        const request = fn(store);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      }),
  );
}

export class IndexedDBBackend implements FSProvider {
  constructor(private prefix = "vfs") {}

  private key(path: string): string {
    return `${this.prefix}:${normalizePath(path)}`;
  }

  async readFile(path: string): Promise<string> {
    const record = await withStore<FileRecord | undefined>(
      FILES_STORE,
      "readonly",
      (store) => store.get(this.key(path)),
    );
    if (!record) throw new Error(`ENOENT: ${path}`);
    return record.content;
  }

  async writeFile(path: string, content: string): Promise<void> {
    const dir = dirname(normalizePath(path));
    if (dir && !(await this.dirExists(dir))) {
      throw new Error(`ENOENT: ${dir}`);
    }
    const record: FileRecord = { content, mtime: Date.now() };
    await withStore(FILES_STORE, "readwrite", (store) =>
      store.put(record, this.key(path)),
    );
  }

  async unlink(path: string): Promise<void> {
    await withStore(FILES_STORE, "readwrite", (store) =>
      store.delete(this.key(path)),
    );
  }

  async stat(path: string): Promise<FileStats> {
    const normalized = normalizePath(path);
    const record = await withStore<FileRecord | undefined>(
      FILES_STORE,
      "readonly",
      (store) => store.get(this.key(normalized)),
    );
    if (record) {
      return createFileStats(
        record.content.length,
        new Date(record.mtime),
        false,
      );
    }
    if (await this.dirExists(normalized)) {
      return createFileStats(0, new Date(), true);
    }
    throw new Error(`ENOENT: ${path}`);
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    const normalized = normalizePath(path);
    if (await this.dirExists(normalized)) return;

    const parent = dirname(normalized);
    if (parent && !(await this.dirExists(parent))) {
      if (options?.recursive) {
        await this.mkdir(parent, options);
      } else {
        throw new Error(`ENOENT: ${parent}`);
      }
    }

    await withStore(DIRS_STORE, "readwrite", (store) =>
      store.put(Date.now(), this.key(normalized)),
    );
  }

  async readdir(path: string): Promise<DirEntry[]> {
    const normalized = normalizePath(path);
    if (normalized && !(await this.dirExists(normalized))) {
      throw new Error(`ENOENT: ${path}`);
    }

    const prefix = normalized ? `${this.key(normalized)}/` : `${this.prefix}:`;
    const entries = new Map<string, boolean>();

    const fileKeys = await withStore<IDBValidKey[]>(
      FILES_STORE,
      "readonly",
      (store) => store.getAllKeys(),
    );
    for (const key of fileKeys as string[]) {
      if (key.startsWith(prefix)) {
        const rest = key.slice(prefix.length);
        const name = rest.split("/")[0];
        if (name && !rest.includes("/")) entries.set(name, false);
      }
    }

    const dirKeys = await withStore<IDBValidKey[]>(
      DIRS_STORE,
      "readonly",
      (store) => store.getAllKeys(),
    );
    for (const key of dirKeys as string[]) {
      if (key.startsWith(prefix)) {
        const rest = key.slice(prefix.length);
        const name = rest.split("/")[0];
        if (name && !rest.includes("/")) entries.set(name, true);
      }
    }

    return Array.from(entries).map(([name, isDir]) =>
      createDirEntry(name, isDir),
    );
  }

  async rmdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    const normalized = normalizePath(path);
    if (!(await this.dirExists(normalized))) {
      throw new Error(`ENOENT: ${path}`);
    }

    const prefix = `${this.key(normalized)}/`;

    if (options?.recursive) {
      const fileKeys = await withStore<IDBValidKey[]>(
        FILES_STORE,
        "readonly",
        (store) => store.getAllKeys(),
      );
      for (const key of fileKeys as string[]) {
        if (key.startsWith(prefix)) {
          await withStore(FILES_STORE, "readwrite", (store) =>
            store.delete(key),
          );
        }
      }

      const dirKeys = await withStore<IDBValidKey[]>(
        DIRS_STORE,
        "readonly",
        (store) => store.getAllKeys(),
      );
      for (const key of dirKeys as string[]) {
        if (key.startsWith(prefix)) {
          await withStore(DIRS_STORE, "readwrite", (store) =>
            store.delete(key),
          );
        }
      }
    }

    await withStore(DIRS_STORE, "readwrite", (store) =>
      store.delete(this.key(normalized)),
    );
  }

  async exists(path: string): Promise<boolean> {
    const normalized = normalizePath(path);
    const record = await withStore<FileRecord | undefined>(
      FILES_STORE,
      "readonly",
      (store) => store.get(this.key(normalized)),
    );
    if (record) return true;
    return this.dirExists(normalized);
  }

  private async dirExists(path: string): Promise<boolean> {
    if (!path) return true; // Root always exists
    const result = await withStore<number | undefined>(
      DIRS_STORE,
      "readonly",
      (store) => store.get(this.key(path)),
    );
    return result !== undefined;
  }
}
