import Database from "better-sqlite3";
import type { EventBus } from "@patchwork/events";
import { createEnvelope } from "@patchwork/events";
import type {
  Entity,
  EntityLink,
  EntityGraph,
  EntityFilter,
  ViewDefinition,
  ViewResult,
} from "./types.js";
import { normalizeUri } from "./uri.js";
import { LinkExtractorRegistry } from "./extractors.js";

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS entities (
    uri TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    attrs TEXT NOT NULL,
    version TEXT,
    synced_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);

  CREATE TABLE IF NOT EXISTS links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_uri TEXT NOT NULL,
    to_uri TEXT NOT NULL,
    type TEXT NOT NULL,
    attrs TEXT,
    UNIQUE(from_uri, to_uri, type),
    FOREIGN KEY (from_uri) REFERENCES entities(uri) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_links_from ON links(from_uri);
  CREATE INDEX IF NOT EXISTS idx_links_to ON links(to_uri);
  CREATE INDEX IF NOT EXISTS idx_links_type ON links(type);

  CREATE TABLE IF NOT EXISTS entity_versions (
    uri TEXT NOT NULL,
    version TEXT NOT NULL,
    attrs TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (uri, version)
  );

  CREATE TABLE IF NOT EXISTS views (
    name TEXT PRIMARY KEY,
    query TEXT NOT NULL,
    path TEXT NOT NULL,
    format TEXT NOT NULL,
    template TEXT,
    ttl INTEGER,
    last_generated_at TEXT
  );
`;

export interface EntityStoreOptions {
  dbPath?: string;
  eventBus?: EventBus;
  autoExtractLinks?: boolean;
}

export class EntityStore implements EntityGraph {
  private db: Database.Database;
  private eventBus?: EventBus;
  private extractors: LinkExtractorRegistry;
  private autoExtractLinks: boolean;

  constructor(options: EntityStoreOptions = {}) {
    const dbPath = options.dbPath ?? ":memory:";
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(SCHEMA);

    this.eventBus = options.eventBus;
    this.extractors = new LinkExtractorRegistry();
    this.autoExtractLinks = options.autoExtractLinks ?? true;
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

    if (entity.links) {
      for (const link of entity.links) {
        await this.link(normalizedUri, link.targetUri, link.type, link.attrs);
      }
    }

    if (this.autoExtractLinks) {
      const content = this.getTextContent(entity);
      if (content) {
        const extractedLinks = this.extractors.extractAll(content, normalizedUri);
        for (const link of extractedLinks) {
          await this.link(normalizedUri, link.targetUri, link.type, link.attrs);
        }
      }
    }

    if (this.eventBus) {
      await this.eventBus.publish(
        createEnvelope(
          existing ? "entity.updated" : "entity.created",
          "entity-graph",
          { uri: normalizedUri, type: entity.type }
        )
      );
    }
  }

  async upsertBatch(entities: Entity[]): Promise<void> {
    const transaction = this.db.transaction(() => {
      for (const entity of entities) {
        const normalizedUri = normalizeUri(entity.uri);
        const now = new Date().toISOString();

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

    if (this.autoExtractLinks) {
      for (const entity of entities) {
        const content = this.getTextContent(entity);
        if (content) {
          const normalizedUri = normalizeUri(entity.uri);
          const extractedLinks = this.extractors.extractAll(content, normalizedUri);
          for (const link of extractedLinks) {
            await this.link(normalizedUri, link.targetUri, link.type, link.attrs);
          }
        }
      }
    }
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

      const links = await this.getLinks(normalizedUri);

      return {
        uri: normalizedUri,
        type: entityRow.type,
        attrs: JSON.parse(versionRow.attrs),
        version,
        syncedAt: entityRow.synced_at,
        links,
      };
    }

    const row = this.db
      .prepare("SELECT * FROM entities WHERE uri = ?")
      .get(normalizedUri) as Record<string, unknown> | undefined;

    if (!row) return null;

    const links = await this.getLinks(normalizedUri);

    return {
      uri: row.uri as string,
      type: row.type as string,
      attrs: JSON.parse(row.attrs as string),
      version: row.version as string | undefined,
      syncedAt: row.synced_at as string | undefined,
      links,
    };
  }

  async delete(uri: string): Promise<void> {
    const normalizedUri = normalizeUri(uri);

    this.db.prepare("DELETE FROM links WHERE from_uri = ? OR to_uri = ?").run(
      normalizedUri,
      normalizedUri
    );
    this.db.prepare("DELETE FROM entity_versions WHERE uri = ?").run(normalizedUri);
    this.db.prepare("DELETE FROM entities WHERE uri = ?").run(normalizedUri);

    if (this.eventBus) {
      await this.eventBus.publish(
        createEnvelope("entity.deleted", "entity-graph", { uri: normalizedUri })
      );
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
        INSERT INTO links (from_uri, to_uri, type, attrs)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(from_uri, to_uri, type) DO UPDATE SET attrs = excluded.attrs
      `)
      .run(fromNorm, toNorm, type, attrs ? JSON.stringify(attrs) : null);

    if (this.eventBus) {
      await this.eventBus.publish(
        createEnvelope("entity.linked", "entity-graph", {
          from: fromNorm,
          to: toNorm,
          type,
        })
      );
    }
  }

  async unlink(fromUri: string, toUri: string, type: string): Promise<void> {
    const fromNorm = normalizeUri(fromUri);
    const toNorm = normalizeUri(toUri);

    this.db
      .prepare("DELETE FROM links WHERE from_uri = ? AND to_uri = ? AND type = ?")
      .run(fromNorm, toNorm, type);

    if (this.eventBus) {
      await this.eventBus.publish(
        createEnvelope("entity.unlinked", "entity-graph", {
          from: fromNorm,
          to: toNorm,
          type,
        })
      );
    }
  }

  async query(filter: EntityFilter): Promise<Entity[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.types?.length) {
      const placeholders = filter.types.map(() => "?").join(", ");
      conditions.push(`type IN (${placeholders})`);
      params.push(...filter.types);
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

    const entities: Entity[] = [];
    for (const row of rows) {
      const links = await this.getLinks(row.uri as string);
      entities.push({
        uri: row.uri as string,
        type: row.type as string,
        attrs: JSON.parse(row.attrs as string),
        version: row.version as string | undefined,
        syncedAt: row.synced_at as string | undefined,
        links,
      });
    }

    return entities;
  }

  async traverse(uri: string, depth: number = 1): Promise<Entity[]> {
    const normalizedUri = normalizeUri(uri);
    const visited = new Set<string>();
    const result: Entity[] = [];

    const queue: { uri: string; currentDepth: number }[] = [
      { uri: normalizedUri, currentDepth: 0 },
    ];

    while (queue.length > 0) {
      const { uri: currentUri, currentDepth } = queue.shift()!;

      if (visited.has(currentUri)) continue;
      visited.add(currentUri);

      const entity = await this.get(currentUri);
      if (entity) {
        result.push(entity);

        if (currentDepth < depth) {
          const linkedUris = this.db
            .prepare("SELECT to_uri FROM links WHERE from_uri = ?")
            .all(currentUri) as { to_uri: string }[];

          const backlinkedUris = this.db
            .prepare("SELECT from_uri FROM links WHERE to_uri = ?")
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

  async inferSchema(type: string): Promise<Record<string, unknown>> {
    const entities = await this.query({ types: [type], limit: 100 });
    if (entities.length === 0) {
      return { type: "object", properties: {} };
    }

    const properties: Record<string, { type: string; count: number }> = {};

    for (const entity of entities) {
      for (const [key, value] of Object.entries(entity.attrs)) {
        const valueType = this.inferValueType(value);
        if (!properties[key]) {
          properties[key] = { type: valueType, count: 1 };
        } else {
          properties[key].count++;
          if (properties[key].type !== valueType) {
            properties[key].type = "unknown";
          }
        }
      }
    }

    const required: string[] = [];
    const schemaProps: Record<string, { type: string }> = {};

    for (const [key, info] of Object.entries(properties)) {
      schemaProps[key] = { type: info.type };
      if (info.count === entities.length) {
        required.push(key);
      }
    }

    return {
      type: "object",
      properties: schemaProps,
      required,
    };
  }

  async getTypes(): Promise<string[]> {
    const rows = this.db
      .prepare("SELECT DISTINCT type FROM entities")
      .all() as { type: string }[];

    return rows.map((r) => r.type);
  }

  async registerView(view: ViewDefinition): Promise<void> {
    this.db
      .prepare(`
        INSERT INTO views (name, query, path, format, template, ttl)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET
          query = excluded.query,
          path = excluded.path,
          format = excluded.format,
          template = excluded.template,
          ttl = excluded.ttl
      `)
      .run(view.name, view.query, view.path, view.format, view.template ?? null, view.ttl ?? null);
  }

  async getView(name: string): Promise<ViewDefinition | null> {
    const row = this.db
      .prepare("SELECT * FROM views WHERE name = ?")
      .get(name) as Record<string, unknown> | undefined;

    if (!row) return null;

    return {
      name: row.name as string,
      query: row.query as string,
      path: row.path as string,
      format: row.format as ViewDefinition["format"],
      template: row.template as string | undefined,
      ttl: row.ttl as number | undefined,
    };
  }

  async generateView(name: string): Promise<ViewResult | null> {
    const view = await this.getView(name);
    if (!view) return null;

    const entities = await this.query({ limit: 1000 });

    let content: string;
    switch (view.format) {
      case "json":
        content = JSON.stringify(entities, null, 2);
        break;
      case "yaml":
        content = this.toYaml(entities);
        break;
      case "markdown":
      default:
        content = this.toMarkdown(entities, view.template);
        break;
    }

    const now = new Date().toISOString();
    this.db
      .prepare("UPDATE views SET last_generated_at = ? WHERE name = ?")
      .run(now, name);

    return {
      name: view.name,
      path: view.path,
      content,
      entities,
      generatedAt: now,
    };
  }

  private async getLinks(uri: string): Promise<EntityLink[]> {
    const rows = this.db
      .prepare("SELECT to_uri, type, attrs FROM links WHERE from_uri = ?")
      .all(uri) as { to_uri: string; type: string; attrs: string | null }[];

    return rows.map((row) => ({
      targetUri: row.to_uri,
      type: row.type,
      attrs: row.attrs ? JSON.parse(row.attrs) : undefined,
    }));
  }

  private getTextContent(entity: Entity): string | null {
    const attrs = entity.attrs;
    if (typeof attrs.body === "string") return attrs.body;
    if (typeof attrs.content === "string") return attrs.content;
    if (typeof attrs.description === "string") return attrs.description;
    if (typeof attrs.text === "string") return attrs.text;
    return null;
  }

  private inferValueType(value: unknown): string {
    if (value === null) return "null";
    if (Array.isArray(value)) return "array";
    const type = typeof value;
    if (type === "object") return "object";
    return type;
  }

  private toYaml(entities: Entity[]): string {
    return entities.map((e) => `- uri: ${e.uri}\n  type: ${e.type}`).join("\n");
  }

  private toMarkdown(entities: Entity[], template?: string): string {
    if (template) {
      return entities
        .map((e) =>
          template
            .replace(/\{\{uri\}\}/g, e.uri)
            .replace(/\{\{type\}\}/g, e.type)
            .replace(/\{\{attrs\.(\w+)\}\}/g, (_, key) => String(e.attrs[key] ?? ""))
        )
        .join("\n\n");
    }

    return entities.map((e) => `## ${e.uri}\n\nType: ${e.type}\n`).join("\n");
  }

  close(): void {
    this.db.close();
  }
}
