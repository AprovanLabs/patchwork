import type { StorageBackend } from '../types.js';

export interface S3Config {
  bucket: string;
  region: string;
  prefix?: string;
  credentials?: { accessKeyId: string; secretAccessKey: string };
}

export class S3Backend implements StorageBackend {
  constructor(private config: S3Config) {}

  private get baseUrl(): string {
    return `https://${this.config.bucket}.s3.${this.config.region}.amazonaws.com`;
  }

  private key(path: string): string {
    return this.config.prefix ? `${this.config.prefix}/${path}` : path;
  }

  async get(path: string): Promise<string | null> {
    const res = await fetch(`${this.baseUrl}/${this.key(path)}`);
    if (!res.ok) return null;
    return res.text();
  }

  async put(path: string, content: string): Promise<void> {
    await fetch(`${this.baseUrl}/${this.key(path)}`, {
      method: 'PUT',
      body: content,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  async delete(path: string): Promise<void> {
    await fetch(`${this.baseUrl}/${this.key(path)}`, { method: 'DELETE' });
  }

  async list(prefix?: string): Promise<string[]> {
    const listPrefix = prefix ? this.key(prefix) : this.config.prefix || '';
    const res = await fetch(
      `${this.baseUrl}?list-type=2&prefix=${encodeURIComponent(listPrefix)}`,
    );
    const xml = await res.text();
    return this.parseListResponse(xml);
  }

  async exists(path: string): Promise<boolean> {
    const res = await fetch(`${this.baseUrl}/${this.key(path)}`, {
      method: 'HEAD',
    });
    return res.ok;
  }

  private parseListResponse(xml: string): string[] {
    const matches = xml.matchAll(/<Key>([^<]+)<\/Key>/g);
    const prefixLen = this.config.prefix ? this.config.prefix.length + 1 : 0;
    return Array.from(matches, (m) => (m[1] ?? '').slice(prefixLen));
  }
}
