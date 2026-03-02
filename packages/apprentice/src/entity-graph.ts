import type Database from "better-sqlite3";
import type { Entity, EntityLink, EntityFilter, EntityGraph, EventBus, Envelope } from "./types.js";
import { normalizeUri, getScheme } from "./uri.js";
import { v4 as uuid } from "uuid";

export interface EntityGraphOptions {
  db: Database.Database;
  eventBus?: EventBus;
}

export class EntityGraphImpl implements EntityGraph {
  private db: Database.Database;
  private eventBus?: EventBus;

  constructor(options: EntityGraphOptions) {
    this.db = options.db;
    this.eventBus = options.eventBus;
  }

  async upsert(entity: Entity): Promise<void> {
    const normalizedUri = normalizeUri(entity.uri);
    const now = new Date().toISOString();
    const existing = await this.get(normalizedUri);

    this.db
      .prepare(`
        INSERT INTO entities (uri, type, attrs, version, synced_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(uri) DO UPDATE SET
          type = excluded.type,
          attrs = excluded.attrs,
          version = excluded.version,
          synced_at = excluded.synced_at
      `)
      .run(
        normalizedUri,
        entity.type,
        JSON.stringify(entity.attrs),
        entity.version ?? null,
        entity.syncedAt ?? now
      );

    if (entity.version) {
      this.db
        .prepare(`
          INSERT OR IGNORE INTO entity_versions (uri, version, attrs, created_at)
          VALUES (?, ?, ?, ?)
        `)
        .run(normalizedUri, entity.version, JSON.stringify(entity.attrs), now);
    }

    if (this.eventBus) {
      await this.eventBus.publish(this.createEnvelope(
        existing ? "entity.updated" : "entity.created",
        { uri: normalizedUri, type: entity.type }
      ));
    }
  }

  async upsertBatch(entities: Entity[]): Promise<void> {
    const transaction = this.db.transaction(() => {
      const now = new Date().toISOString();
      for (const entity of entities) {
        const normalizedUri = normalizeUri(entity.uri);
        this.db
          .prepare(`
            INSERT INTO entities (uri, type, attrs, version, synced_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(uri) DO UPDATE SET
              type = excluded.type,
              attrs = excluded.attrs,
              version = excluded.version,
              synced_at = excluded.synced_at
          `)
          .run(
            normalizedUri,
            entity.type,
            JSON.stringify(entity.attrs),
            entity.version ?? null,
            entity.syncedAt ?? now
          );

        if (entity.version) {
          this.db
            .prepare(`
              INSERT OR IGNORE INTO entity_versions (uri, version, attrs, created_at)
              VALUES (?, ?, ?, ?)
            `)
            .run(normalizedUri, entity.version, JSON.stringify(entity.attrs), now);
        }
      }
    });

    transaction();
  }

  async get(uri: string, version?: string): Promise<Entity | null> {
    const normalizedUri = normalizeUri(uri);

    if (version) {
      const versionRow = this.db
        .prepare("SELECT attrs FROM entity_versions WHERE uri = ? AND version = ?")
        .get(normalizedUri, version) as { attrs: string } | undefined;

      if (!versionRow) return null;

      const entityRow = this.db
        .prepare("SELECT type, synced_at FROM entities WHERE uri = ?")
        .get(normalizedUri) as { type: string; synced_at: string } | undefined;

      if (!entityRow) return null;

      return {
        uri: normalizedUri,
        type: entityRow.type,
        attrs: JSON.parse(versionRow.attrs),
        version,
        syncedAt: entityRow.synced_at,
      };
    }

    const row = this.db
      .prepare("SELECT * FROM entities WHERE uri = ?")
      .get(normalizedUri) as Record<string, unknown> | undefined;

    if (!row) return null;

    return {
      uri: row.uri as string,
      type: row.type as string,
      attrs: JSON.parse(row.attrs as string),
      version: row.version as string | undefined,
      syncedAt: row.synced_at as string | undefined,
    };
  }

  async delete(uri: string): Promise<void> {
    const normalizedUri = normalizeUri(uri);

    this.db.prepare("DELETE FROM entity_links WHERE from_uri = ? OR to_uri = ?").run(
      normalizedUri,
      normalizedUri
    );
    this.db.prepare("DELETE FROM entity_versions WHERE uri = ?").run(normalizedUri);
    this.db.prepare("DELETE FROM entities WHERE uri = ?").run(normalizedUri);

    if (this.eventBus) {
      await this.eventBus.publish(this.createEnvelope("entity.deleted", { uri: normalizedUri }));
    }
  }

  async link(
    fromUri: string,
    toUri: string,
    type: string,
    attrs?: Record<string, unknown>
  ): Promise<void> {
    const fromNorm = normalizeUri(fromUri);
    const toNorm = normalizeUri(toUri);

    this.db
      .prepare(`
        INSERT INTO entity_links (from_uri, to_uri, type, attrs)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(from_uri, to_uri, type) DO UPDATE SET attrs = excluded.attrs
      `)
      .run(fromNorm, toNorm, type, attrs ? JSON.stringify(attrs) : null);

    if (this.eventBus) {
      await this.eventBus.publish(this.createEnvelope("entity.linked", {
        from: fromNorm,
        to: toNorm,
        type,
      }));
    }
  }

  async unlink(fromUri: string, toUri: string, type: string): Promise<void> {
    const fromNorm = normalizeUri(fromUri);
    const toNorm = normalizeUri(toUri);

    this.db
      .prepare("DELETE FROM entity_links WHERE from_uri = ? AND to_uri = ? AND type = ?")
      .run(fromNorm, toNorm, type);

    if (this.eventBus) {
      await this.eventBus.publish(this.createEnvelope("entity.unlinked", {
        from: fromNorm,
        to: toNorm,
        type,
      }));
    }
  }

  async getLinks(uri: string, direction: "outgoing" | "incoming" | "both" = "outgoing"): Promise<EntityLink[]> {
    const normalizedUri = normalizeUri(uri);
    const links: EntityLink[] = [];

    if (direction === "outgoing" || direction === "both") {
      const outgoing = this.db
        .prepare("SELECT from_uri, to_uri, type, attrs FROM entity_links WHERE from_uri = ?")
        .all(normalizedUri) as { from_uri: string; to_uri: string; type: string; attrs: string | null }[];

      for (const row of outgoing) {
        links.push({
          fromUri: row.from_uri,
          toUri: row.to_uri,
          type: row.type,
          attrs: row.attrs ? JSON.parse(row.attrs) : undefined,
        });
      }
    }

    if (direction === "incoming" || direction === "both") {
      const incoming = this.db
        .prepare("SELECT from_uri, to_uri, type, attrs FROM entity_links WHERE to_uri = ?")
        .all(normalizedUri) as { from_uri: string; to_uri: string; type: string; attrs: string | null }[];

      for (const row of incoming) {
        links.push({
          fromUri: row.from_uri,
          toUri: row.to_uri,
          type: row.type,
          attrs: row.attrs ? JSON.parse(row.attrs) : undefined,
        });
      }
    }

    return links;
  }

  async query(filter: EntityFilter): Promise<Entity[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.types?.length) {
      const placeholders = filter.types.map(() => "?").join(", ");
      conditions.push(`type IN (${placeholders})`);
      params.push(...filter.types);
    }

    if (filter.schemes?.length) {
      const schemeConditions = filter.schemes.map(() => "substr(uri, 1, instr(uri, ':') - 1) = ?");
      conditions.push(`(${schemeConditions.join(" OR ")})`);
      params.push(...filter.schemes);
    }

    if (filter.uris?.length) {
      const placeholders = filter.uris.map(() => "?").join(", ");
      conditions.push(`uri IN (${placeholders})`);
      params.push(...filter.uris.map(normalizeUri));
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = filter.limit ?? 100;
    const offset = filter.offset ?? 0;

    const rows = this.db
      .prepare(`SELECT * FROM entities ${whereClause} LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as Record<string, unknown>[];

    return rows.map((row) => ({
      uri: row.uri as string,
      type: row.type as string,
      attrs: JSON.parse(row.attrs as string),
      version: row.version as string | undefined,
      syncedAt: row.synced_at as string | undefined,
    }));
  }

  async traverse(uri: string, depth: number = 1): Promise<Entity[]> {
    const normalizedUri = normalizeUri(uri);
    const visited = new Set<string>();
    const result: Entity[] = [];

    const queue: { uri: string; currentDepth: number }[] = [
      { uri: normalizedUri, currentDepth: 0 },
    ];

    while (queue.length > 0) {
      const item = queue.shift()!;
      const { uri: currentUri, currentDepth } = item;

      if (visited.has(currentUri)) continue;
      visited.add(currentUri);

      const entity = await this.get(currentUri);
      if (entity) {
        result.push(entity);

        if (currentDepth < depth) {
          const linkedUris = this.db
            .prepare("SELECT to_uri FROM entity_links WHERE from_uri = ?")
            .all(currentUri) as { to_uri: string }[];

          const backlinkedUris = this.db
            .prepare("SELECT from_uri FROM entity_links WHERE to_uri = ?")
            .all(currentUri) as { from_uri: string }[];

          for (const { to_uri } of linkedUris) {
            if (!visited.has(to_uri)) {
              queue.push({ uri: to_uri, currentDepth: currentDepth + 1 });
            }
          }

          for (const { from_uri } of backlinkedUris) {
            if (!visited.has(from_uri)) {
              queue.push({ uri: from_uri, currentDepth: currentDepth + 1 });
            }
          }
        }
      }
    }

    return result;
  }

  async upsertFile(path: string, attrs: Record<string, unknown> = {}): Promise<Entity> {
    const uri = `file:${path.startsWith("/") ? path : "/" + path}`;
    const entity: Entity = {
      uri,
      type: "file",
      attrs: { path, ...attrs },
    };
    await this.upsert(entity);
    return entity;
  }

  async upsertEvent(envelope: Envelope): Promise<Entity> {
    const uri = `event:${envelope.id}`;
    const entity: Entity = {
      uri,
      type: "event",
      attrs: {
        eventType: envelope.type,
        source: envelope.source,
        subject: envelope.subject,
        timestamp: envelope.timestamp,
        data: envelope.data,
        metadata: envelope.metadata,
      },
    };
    await this.upsert(entity);
    return entity;
  }

  async queryByScheme(scheme: string): Promise<Entity[]> {
    return this.query({ schemes: [scheme] });
  }

  private createEnvelope(type: string, data: unknown): Envelope {
    return {
      id: uuid(),
      timestamp: new Date().toISOString(),
      type,
      source: "entity-graph",
      data,
      metadata: {},
    };
  }
}
