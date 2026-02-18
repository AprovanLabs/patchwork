// Service Types - Core types for the service proxy system

/**
 * Result of a service call
 */
export interface ServiceResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  cached?: boolean;
  durationMs: number;
}

/**
 * Cache configuration for a service
 */
export interface CacheConfig {
  /** TTL in seconds */
  ttl: number;
}

/**
 * Cache entry
 */
export interface CacheEntry {
  result: ServiceResult;
  expiresAt: number;
}
