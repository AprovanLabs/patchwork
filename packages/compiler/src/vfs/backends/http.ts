import { createDirEntry, createFileStats } from "../core/utils.js";
import type {
  DirEntry,
  FileStats,
  FSProvider,
  WatchCallback,
} from "../core/types.js";

export interface HttpBackendConfig {
  baseUrl: string;
  /** How often to poll for external changes, in milliseconds. Default: 7000. */
  pollIntervalMs?: number;
}

interface StatResponse {
  size: number;
  mtime: string;
  isFile: boolean;
  isDirectory: boolean;
}

interface ChangeEntry {
  path: string;
  mtime: string;
  version: number;
  size: number;
}

/**
 * HTTP-based FSProvider for connecting to remote VFS servers
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

  watch(_path: string, callback: WatchCallback): () => void {
    const controller = new AbortController();
    this.startPoll(callback, controller.signal);
    return () => controller.abort();
  }

  private async startPoll(
    callback: WatchCallback,
    signal: AbortSignal,
  ): Promise<void> {
    const intervalMs = this.config.pollIntervalMs ?? 7_000;
    // Start `since` at subscription time so we only surface writes that happen
    // after the caller registered. Captured before each request so any write
    // that arrives while the request is in-flight is not skipped.
    let since = new Date().toISOString();

    const poll = async () => {
      if (signal.aborted) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;

      const pollStart = new Date().toISOString();
      try {
        const res = await fetch(this.url("", { since }), { signal });
        if (!res.ok) return;
        const changes: ChangeEntry[] = await res.json();
        // Advance the cursor regardless of whether changes were returned so
        // the next poll does not re-examine the same window.
        since = pollStart;
        for (const change of changes) {
          callback("update", change.path);
        }
      } catch {
        // Network error or abort — leave `since` unchanged and retry next tick.
      }
    };

    // Immediate first poll to catch any writes that happened just before mount.
    await poll();
    if (signal.aborted) return;

    const timer = setInterval(() => void poll(), intervalMs);

    // Poll immediately when the tab regains focus.
    const onVisibilityChange = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        void poll();
      }
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }

    signal.addEventListener("abort", () => {
      clearInterval(timer);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
    });
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
