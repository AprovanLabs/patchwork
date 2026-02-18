import type { StorageBackend } from '../types.js';

const DB_NAME = 'patchwork-vfs';
const STORE_NAME = 'files';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
  });
}

function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode);
        const store = tx.objectStore(STORE_NAME);
        const request = fn(store);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      }),
  );
}

export class IndexedDBBackend implements StorageBackend {
  constructor(private prefix = 'vfs') {}

  private key(path: string): string {
    return `${this.prefix}:${path}`;
  }

  async get(path: string): Promise<string | null> {
    const result = await withStore('readonly', (store) =>
      store.get(this.key(path)),
    );
    return result ?? null;
  }

  async put(path: string, content: string): Promise<void> {
    await withStore('readwrite', (store) => store.put(content, this.key(path)));
  }

  async delete(path: string): Promise<void> {
    await withStore('readwrite', (store) => store.delete(this.key(path)));
  }

  async list(prefix?: string): Promise<string[]> {
    const keyPrefix = prefix ? this.key(prefix) : this.key('');
    const allKeys = await withStore('readonly', (store) => store.getAllKeys());
    return (allKeys as string[])
      .filter((k) => k.startsWith(keyPrefix))
      .map((k) => k.slice(this.prefix.length + 1));
  }

  async exists(path: string): Promise<boolean> {
    return (await this.get(path)) !== null;
  }
}
