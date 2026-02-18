import type { StorageBackend } from '../types.js';

export interface LocalFSConfig {
  baseUrl: string;
}

export class LocalFSBackend implements StorageBackend {
  constructor(private config: LocalFSConfig) {}

  async get(path: string): Promise<string | null> {
    const res = await fetch(`${this.config.baseUrl}/${path}`);
    if (!res.ok) return null;
    return res.text();
  }

  async put(path: string, content: string): Promise<void> {
    await fetch(`${this.config.baseUrl}/${path}`, {
      method: 'PUT',
      body: content,
    });
  }

  async delete(path: string): Promise<void> {
    await fetch(`${this.config.baseUrl}/${path}`, { method: 'DELETE' });
  }

  async list(prefix?: string): Promise<string[]> {
    const url = prefix
      ? `${this.config.baseUrl}?prefix=${encodeURIComponent(prefix)}`
      : this.config.baseUrl;
    const res = await fetch(url);
    return res.json();
  }

  async exists(path: string): Promise<boolean> {
    const res = await fetch(`${this.config.baseUrl}/${path}`, {
      method: 'HEAD',
    });
    return res.ok;
  }
}
