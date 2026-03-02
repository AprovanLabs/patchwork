import Database from "better-sqlite3";
import * as semver from "semver";
import type {
  ServiceDefinition,
  ServiceSummary,
  JsonSchema,
  CacheEntry,
  CacheConfig,
} from "./types.js";

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    namespace TEXT NOT NULL,
    version TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_config TEXT NOT NULL,
    procedures TEXT NOT NULL,
    types TEXT NOT NULL,
    registered_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(namespace, version)
  );

  CREATE INDEX IF NOT EXISTS idx_services_namespace ON services(namespace);
  CREATE INDEX IF NOT EXISTS idx_services_version ON services(namespace, version);

  CREATE TABLE IF NOT EXISTS service_cache (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    etag TEXT,
    last_modified TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_cache_expires ON service_cache(expires_at);
`;

export interface ServiceStoreOptions {
  dbPath?: string;
  cache?: CacheConfig;
}

export class ServiceStore {
  private db: Database.Database;
  private cacheConfig: CacheConfig;

  constructor(options: ServiceStoreOptions = {}) {
    const dbPath = options.dbPath ?? ":memory:";
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA);

    this.cacheConfig = options.cache ?? {
      defaultTtl: 300,
      maxEntries: 1000,
    };
  }

  async register(service: ServiceDefinition): Promise<void> {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO services (namespace, version, source_type, source_config, procedures, types, registered_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(namespace, version) DO UPDATE SET
        source_type = excluded.source_type,
        source_config = excluded.source_config,
        procedures = excluded.procedures,
        types = excluded.types,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      service.namespace,
      service.version,
      service.source.type,
      JSON.stringify(service.source.config),
      JSON.stringify(service.procedures),
      JSON.stringify(service.types),
      service.registeredAt ?? now,
      now
    );
  }

  async unregister(namespace: string, version?: string): Promise<void> {
    if (version) {
      this.db
        .prepare("DELETE FROM services WHERE namespace = ? AND version = ?")
        .run(namespace, version);
    } else {
      this.db
        .prepare("DELETE FROM services WHERE namespace = ?")
        .run(namespace);
    }
  }

  async get(
    namespace: string,
    version?: string
  ): Promise<ServiceDefinition | null> {
    let row: Record<string, unknown> | undefined;

    if (version) {
      row = this.db
        .prepare(
          "SELECT * FROM services WHERE namespace = ? AND version = ?"
        )
        .get(namespace, version) as Record<string, unknown> | undefined;
    } else {
      const rows = this.db
        .prepare(
          "SELECT * FROM services WHERE namespace = ? ORDER BY registered_at DESC"
        )
        .all(namespace) as Record<string, unknown>[];

      if (rows.length === 0) return null;

      const sorted = rows.sort((a, b) => {
        const vA = semver.valid(a.version as string);
        const vB = semver.valid(b.version as string);
        if (vA && vB) return semver.rcompare(vA, vB);
        return 0;
      });
      row = sorted[0];
    }

    if (!row) return null;

    return this.rowToService(row);
  }

  async list(): Promise<ServiceSummary[]> {
    const rows = this.db
      .prepare(`
        SELECT namespace, version, source_type, procedures, types
        FROM services
        GROUP BY namespace
        HAVING version = MAX(version)
      `)
      .all() as Record<string, unknown>[];

    return rows.map((row) => ({
      namespace: row.namespace as string,
      version: row.version as string,
      procedureCount: JSON.parse(row.procedures as string).length,
      typeCount: JSON.parse(row.types as string).length,
      sourceType: row.source_type as string,
    }));
  }

  async listVersions(namespace: string): Promise<string[]> {
    const rows = this.db
      .prepare("SELECT version FROM services WHERE namespace = ?")
      .all(namespace) as { version: string }[];

    return rows
      .map((r) => r.version)
      .sort((a, b) => {
        const vA = semver.valid(a);
        const vB = semver.valid(b);
        if (vA && vB) return semver.rcompare(vA, vB);
        return 0;
      });
  }

  async search(query: string): Promise<ServiceDefinition[]> {
    const queryLower = query.toLowerCase();
    const rows = this.db
      .prepare("SELECT * FROM services")
      .all() as Record<string, unknown>[];

    return rows
      .filter((row) => {
        const ns = (row.namespace as string).toLowerCase();
        const procs = JSON.parse(row.procedures as string) as Array<{
          name: string;
          description: string;
        }>;
        const matchNs = ns.includes(queryLower);
        const matchProc = procs.some(
          (p) =>
            p.name.toLowerCase().includes(queryLower) ||
            p.description.toLowerCase().includes(queryLower)
        );
        return matchNs || matchProc;
      })
      .map((row) => this.rowToService(row));
  }

  async getSchema(
    namespace: string,
    typeName: string
  ): Promise<JsonSchema | null> {
    const service = await this.get(namespace);
    if (!service) return null;

    const type = service.types.find((t) => t.name === typeName);
    return type?.schema ?? null;
  }

  async cacheGet(key: string): Promise<unknown | null> {
    this.cleanExpiredCache();

    const row = this.db
      .prepare("SELECT value, expires_at FROM service_cache WHERE key = ?")
      .get(key) as { value: string; expires_at: number } | undefined;

    if (!row) return null;
    if (row.expires_at < Date.now()) {
      this.db.prepare("DELETE FROM service_cache WHERE key = ?").run(key);
      return null;
    }

    return JSON.parse(row.value);
  }

  async cacheSet(
    key: string,
    value: unknown,
    ttl?: number,
    options?: { etag?: string; lastModified?: string }
  ): Promise<void> {
    const expiresAt = Date.now() + (ttl ?? this.cacheConfig.defaultTtl) * 1000;

    this.db
      .prepare(`
        INSERT INTO service_cache (key, value, expires_at, etag, last_modified)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          expires_at = excluded.expires_at,
          etag = excluded.etag,
          last_modified = excluded.last_modified
      `)
      .run(
        key,
        JSON.stringify(value),
        expiresAt,
        options?.etag ?? null,
        options?.lastModified ?? null
      );
  }

  async cacheInvalidate(pattern: string): Promise<number> {
    if (pattern.endsWith("*")) {
      const prefix = pattern.slice(0, -1);
      const result = this.db
        .prepare("DELETE FROM service_cache WHERE key LIKE ?")
        .run(`${prefix}%`);
      return result.changes;
    }

    const result = this.db
      .prepare("DELETE FROM service_cache WHERE key = ?")
      .run(pattern);
    return result.changes;
  }

  async getCacheEntry(key: string): Promise<CacheEntry | null> {
    const row = this.db
      .prepare("SELECT * FROM service_cache WHERE key = ?")
      .get(key) as Record<string, unknown> | undefined;

    if (!row) return null;

    return {
      key: row.key as string,
      value: JSON.parse(row.value as string),
      expiresAt: row.expires_at as number,
      etag: row.etag as string | undefined,
      lastModified: row.last_modified as string | undefined,
    };
  }

  private cleanExpiredCache(): void {
    this.db
      .prepare("DELETE FROM service_cache WHERE expires_at < ?")
      .run(Date.now());
  }

  private rowToService(row: Record<string, unknown>): ServiceDefinition {
    return {
      namespace: row.namespace as string,
      version: row.version as string,
      source: {
        type: row.source_type as ServiceDefinition["source"]["type"],
        config: JSON.parse(row.source_config as string),
      },
      procedures: JSON.parse(row.procedures as string),
      types: JSON.parse(row.types as string),
      registeredAt: row.registered_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  close(): void {
    this.db.close();
  }
}
