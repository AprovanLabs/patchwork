import { createHash } from "node:crypto";
import type { Manifest, VirtualProject } from "@aprovan/patchwork-compiler";

export interface CachedWidget {
  html: string;
  manifest: Manifest;
  resourceUri: string;
  createdAt: number;
}

const MAX_CACHE_SIZE = 256;

const cache = new Map<string, CachedWidget>();

export function computeCacheKey(
  source: string | VirtualProject,
  manifest: Manifest,
): string {
  const parts: string[] = [];

  if (typeof source === "string") {
    parts.push(source);
  } else {
    const sortedFiles = Array.from(source.files.entries()).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    for (const [path, file] of sortedFiles) {
      parts.push(`${path}::${file.content}`);
    }
    parts.push(`entry:${source.entry}`);
  }

  parts.push(JSON.stringify(manifest));

  return createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 16);
}

export function get(hash: string): CachedWidget | undefined {
  return cache.get(hash);
}

export function set(hash: string, entry: CachedWidget): void {
  if (cache.size >= MAX_CACHE_SIZE) {
    const entries = Array.from(cache.entries());
    entries.sort((a, b) => a[1].createdAt - b[1].createdAt);
    const toRemove = entries.slice(0, Math.floor(MAX_CACHE_SIZE / 4));
    for (const [key] of toRemove) {
      cache.delete(key);
    }
  }
  cache.set(hash, entry);
}

export function has(hash: string): boolean {
  return cache.has(hash);
}

export function clear(): void {
  cache.clear();
}

export function size(): number {
  return cache.size;
}

export function allEntries(): Array<[string, CachedWidget]> {
  return Array.from(cache.entries());
}
