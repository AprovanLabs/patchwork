import type Database from "better-sqlite3";
import type { Entity, Envelope } from "./types.js";

export interface SearchResult {
  uri: string;
  type: "entity" | "event";
  score: number;
  snippet?: string;
  data: Entity | Envelope;
}

export interface SearchOptions {
  types?: ("entity" | "event")[];
  limit?: number;
  offset?: number;
}

export interface SearchEngine {
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
  indexEntity(entity: Entity): Promise<void>;
  indexEvent(envelope: Envelope): Promise<void>;
}

const FTS_SCHEMA = `
  CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
    uri,
    content_type,
    text,
    content='',
    contentless_delete=1
  );
`;

export interface SearchEngineOptions {
  db: Database.Database;
}

export class SearchEngineImpl implements SearchEngine {
  private db: Database.Database;
  private initialized = false;

  constructor(options: SearchEngineOptions) {
    this.db = options.db;
  }

  private ensureInitialized(): void {
    if (this.initialized) return;
    this.db.exec(FTS_SCHEMA);
    this.initialized = true;
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    this.ensureInitialized();

    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;
    const typeFilter = options.types?.length
      ? `AND content_type IN (${options.types.map(() => "?").join(", ")})`
      : "";

    const params: unknown[] = [query];
    if (options.types?.length) {
      params.push(...options.types);
    }
    params.push(limit, offset);

    const rows = this.db
      .prepare(`
        SELECT uri, content_type, snippet(search_index, 2, '<mark>', '</mark>', '...', 32) as snippet,
               bm25(search_index) as score
        FROM search_index
        WHERE search_index MATCH ?
        ${typeFilter}
        ORDER BY score
        LIMIT ? OFFSET ?
      `)
      .all(...params) as { uri: string; content_type: string; snippet: string; score: number }[];

    const results: SearchResult[] = [];

    for (const row of rows) {
      const data = await this.loadData(row.uri, row.content_type as "entity" | "event");
      if (data) {
        results.push({
          uri: row.uri,
          type: row.content_type as "entity" | "event",
          score: Math.abs(row.score),
          snippet: row.snippet,
          data,
        });
      }
    }

    return results;
  }

  async indexEntity(entity: Entity): Promise<void> {
    this.ensureInitialized();

    const text = this.extractText(entity.attrs);

    this.db
      .prepare("DELETE FROM search_index WHERE uri = ?")
      .run(entity.uri);

    if (text) {
      this.db
        .prepare("INSERT INTO search_index (uri, content_type, text) VALUES (?, ?, ?)")
        .run(entity.uri, "entity", text);
    }
  }

  async indexEvent(envelope: Envelope): Promise<void> {
    this.ensureInitialized();

    const uri = `event:${envelope.id}`;
    const text = this.extractText(envelope.data);

    this.db
      .prepare("DELETE FROM search_index WHERE uri = ?")
      .run(uri);

    const searchText = [envelope.type, envelope.source, envelope.subject, text]
      .filter(Boolean)
      .join(" ");

    if (searchText) {
      this.db
        .prepare("INSERT INTO search_index (uri, content_type, text) VALUES (?, ?, ?)")
        .run(uri, "event", searchText);
    }
  }

  private extractText(data: unknown): string {
    if (!data) return "";
    if (typeof data === "string") return data;
    if (typeof data !== "object") return String(data);

    const parts: string[] = [];
    const obj = data as Record<string, unknown>;

    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === "string") {
        parts.push(value);
      } else if (typeof value === "number" || typeof value === "boolean") {
        parts.push(String(value));
      } else if (Array.isArray(value)) {
        parts.push(value.filter((v) => typeof v === "string").join(" "));
      }
    }

    return parts.join(" ");
  }

  private async loadData(uri: string, type: "entity" | "event"): Promise<Entity | Envelope | null> {
    if (type === "entity") {
      const row = this.db
        .prepare("SELECT * FROM entities WHERE uri = ?")
        .get(uri) as Record<string, unknown> | undefined;

      if (!row) return null;

      return {
        uri: row.uri as string,
        type: row.type as string,
        attrs: JSON.parse(row.attrs as string),
        version: row.version as string | undefined,
        syncedAt: row.synced_at as string | undefined,
      };
    } else {
      const eventId = uri.replace(/^event:/, "");
      const row = this.db
        .prepare("SELECT * FROM events WHERE id = ?")
        .get(eventId) as Record<string, unknown> | undefined;

      if (!row) return null;

      return {
        id: row.id as string,
        timestamp: row.timestamp as string,
        type: row.type as string,
        source: row.source as string,
        subject: row.subject as string | undefined,
        data: JSON.parse(row.data as string),
        metadata: JSON.parse(row.metadata as string),
      };
    }
  }
}
