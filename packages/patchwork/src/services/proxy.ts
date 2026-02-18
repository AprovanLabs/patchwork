// Service Proxy - Caching layer for service calls
//
// Provides a backend-agnostic service proxy with caching.
// The actual backend (UTCP, MCP, HTTP, etc.) is set via setServiceBackend().

import type { ServiceResult, CacheEntry, CacheConfig } from './types';

/**
 * Service backend interface - abstracts the actual service call mechanism
 *
 * Implementations can use UTCP, MCP, HTTP, or any other protocol.
 */
export interface ServiceBackend {
  /**
   * Call a service procedure
   * @param service - Service namespace (e.g., "git", "github")
   * @param procedure - Procedure name (e.g., "branch", "repos.list")
   * @param args - Arguments to pass
   */
  call(service: string, procedure: string, args: unknown[]): Promise<unknown>;
}

// Current backend (must be set before use)
let currentBackend: ServiceBackend | null = null;

// Cache storage
const cache = new Map<string, CacheEntry>();
const cacheConfig = new Map<string, CacheConfig>();
const MAX_CACHE_SIZE = 1000;

/**
 * Set the service backend
 *
 * This must be called before making any service calls.
 * The backend handles the actual communication with services.
 *
 * @example
 * ```typescript
 * // Using with UTCP
 * setServiceBackend({
 *   call: (service, procedure, args) =>
 *     utcpClient.callTool(`${service}.${procedure}`, args)
 * });
 *
 * // Using with HTTP proxy
 * setServiceBackend({
 *   call: async (service, procedure, args) => {
 *     const res = await fetch(`/api/proxy/${service}/${procedure}`, {
 *       method: 'POST',
 *       body: JSON.stringify({ args })
 *     });
 *     return res.json();
 *   }
 * });
 * ```
 */
export function setServiceBackend(backend: ServiceBackend): void {
  currentBackend = backend;
}

/**
 * Create a service proxy that wraps the backend with caching
 */
export function createServiceProxy(): ServiceBackend {
  return {
    call: (service, procedure, args) =>
      callProcedure(service, procedure, args).then((r) => {
        if (!r.success) throw new Error(r.error || 'Service call failed');
        return r.data;
      }),
  };
}

function getCacheKey(
  service: string,
  procedure: string,
  args: unknown[],
): string {
  return `${service}:${procedure}:${JSON.stringify(args)}`;
}

function evictOldestCache(): void {
  if (cache.size < MAX_CACHE_SIZE) return;
  const oldest = Array.from(cache.entries())
    .sort(([, a], [, b]) => a.expiresAt - b.expiresAt)
    .slice(0, Math.floor(MAX_CACHE_SIZE * 0.2));
  for (const [key] of oldest) cache.delete(key);
}

function getFromCache(key: string): ServiceResult | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return { ...entry.result, cached: true };
}

function setCache(key: string, result: ServiceResult, ttl: number): void {
  evictOldestCache();
  cache.set(key, { result, expiresAt: Date.now() + ttl * 1000 });
}

/**
 * Call a service procedure
 *
 * @param service - Service namespace (e.g., "git", "github")
 * @param procedure - Procedure name (e.g., "branch", "repos.get")
 * @param args - Arguments to pass
 * @param options - Call options
 */
export async function callProcedure(
  service: string,
  procedure: string,
  args: unknown[] = [],
  options: { bypassCache?: boolean } = {},
): Promise<ServiceResult> {
  const cacheKey = getCacheKey(service, procedure, args);
  const ttlConfig = cacheConfig.get(service);

  // Check cache first
  if (!options.bypassCache && ttlConfig) {
    const cached = getFromCache(cacheKey);
    if (cached) return cached;
  }

  // Check if backend is configured
  if (!currentBackend) {
    return {
      success: false,
      error: 'No service backend configured. Call setServiceBackend() first.',
      durationMs: 0,
    };
  }

  const startTime = performance.now();

  try {
    const data = await currentBackend.call(service, procedure, args);

    const serviceResult: ServiceResult = {
      success: true,
      data,
      durationMs: performance.now() - startTime,
    };

    // Cache successful results
    if (ttlConfig) {
      setCache(cacheKey, serviceResult, ttlConfig.ttl);
    }

    return serviceResult;
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: performance.now() - startTime,
    };
  }
}

/**
 * Configure cache TTL for a service
 */
export function configureCacheTtl(service: string, ttl: number): void {
  cacheConfig.set(service, { ttl });
}

/**
 * Invalidate cache entries
 */
export function invalidateCache(service?: string): void {
  if (service) {
    for (const key of cache.keys()) {
      if (key.startsWith(`${service}:`)) cache.delete(key);
    }
  } else {
    cache.clear();
  }
}

/**
 * Get cache statistics
 */
export function getCacheStats(): { size: number; services: string[] } {
  const services = new Set<string>();
  for (const key of cache.keys()) {
    const service = key.split(':')[0];
    if (service) services.add(service);
  }
  return { size: cache.size, services: [...services] };
}

/**
 * Batch call multiple procedures
 */
export interface BatchCall {
  service: string;
  procedure: string;
  args?: unknown[];
  bypassCache?: boolean;
}

export async function batchCall(calls: BatchCall[]): Promise<ServiceResult[]> {
  return Promise.all(
    calls.map((c) =>
      callProcedure(c.service, c.procedure, c.args || [], {
        bypassCache: c.bypassCache,
      }),
    ),
  );
}
