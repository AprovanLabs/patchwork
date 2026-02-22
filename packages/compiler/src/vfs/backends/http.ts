import type {
  DirEntry,
  FileStats,
  FSProvider,
  WatchCallback,
  WatchEventType,
} from "../core/types.js";
import { createDirEntry, createFileStats } from "../core/utils.js";

export interface HttpBackendConfig {
  baseUrl: string;
}

interface StatResponse {
  size: number;
  mtime: string;
  isFile: boolean;
  isDirectory: boolean;
}

interface WatchEvent {
  type: WatchEventType;
  path: string;
  mtime: string;
}

/**
 * HTTP-based FSProvider for connecting to remote servers (e.g., stitchery)
 */
export class HttpBackend implements FSProvider {
  constructor(private config: HttpBackendConfig) {}

  async readFile(path: string): Promise<string> {
    const res = await fetch(this.url(path));
    if (!res.ok) throw new Error(`ENOENT: ${path}`);
    return res.text();
  }

  async writeFile(path: string, content: string): Promise<void> {
    const res = await fetch(this.url(path), {
      method: "PUT",
      body: content,
      headers: { "Content-Type": "text/plain" },
    });
    if (!res.ok) throw new Error(`Failed to write: ${path}`);
  }

  async unlink(path: string): Promise<void> {
    const res = await fetch(this.url(path), { method: "DELETE" });
    if (!res.ok) throw new Error(`Failed to delete: ${path}`);
  }

  async stat(path: string): Promise<FileStats> {
    const res = await fetch(this.url(path, { stat: "true" }));
    if (!res.ok) throw new Error(`ENOENT: ${path}`);
    const data: StatResponse = await res.json();
    return createFileStats(data.size, new Date(data.mtime), data.isDirectory);
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    const params: Record<string, string> = { mkdir: "true" };
    if (options?.recursive) params.recursive = "true";
    const res = await fetch(this.url(path, params), { method: "POST" });
    if (!res.ok) throw new Error(`Failed to mkdir: ${path}`);
  }

  async readdir(path: string): Promise<DirEntry[]> {
    const res = await fetch(this.url(path, { readdir: "true" }));
    if (!res.ok) throw new Error(`ENOENT: ${path}`);
    const entries: Array<{ name: string; isDirectory: boolean }> =
      await res.json();
    return entries.map((e) => createDirEntry(e.name, e.isDirectory));
  }

  async rmdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    const params: Record<string, string> = {};
    if (options?.recursive) params.recursive = "true";
    const res = await fetch(this.url(path, params), { method: "DELETE" });
    if (!res.ok) throw new Error(`Failed to rmdir: ${path}`);
  }

  async exists(path: string): Promise<boolean> {
    const res = await fetch(this.url(path), { method: "HEAD" });
    return res.ok;
  }

  watch(path: string, callback: WatchCallback): () => void {
    const controller = new AbortController();
    this.startWatch(path, callback, controller.signal);
    return () => controller.abort();
  }

  private async startWatch(
    path: string,
    callback: WatchCallback,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      const res = await fetch(this.url("", { watch: path }), { signal });
      if (!res.ok) return;
      const reader = res.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = "";

      while (!signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const event: WatchEvent = JSON.parse(line.slice(6));
              callback(event.type, event.path);
            } catch {
              // Ignore parse errors
            }
          }
        }
      }
    } catch {
      // Connection closed or aborted
    }
  }

  private url(path: string, params?: Record<string, string>): string {
    const baseUrl = this.config.baseUrl.replace(/\/+$/, "");
    const cleanPath = path.replace(/^\/+/, "");
    const base = cleanPath ? `${baseUrl}/${cleanPath}` : baseUrl;
    if (!params) return base;
    const query = new URLSearchParams(params).toString();
    return `${base}?${query}`;
  }
}
