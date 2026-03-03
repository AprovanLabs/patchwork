import Database from "better-sqlite3";
import { v7 as uuidv7 } from "uuid";
import type {
  Envelope,
  EventBus,
  EventFilter,
  EventHandler,
  QueryOptions,
  Subscription,
} from "./types.js";

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    timestamp TEXT NOT NULL,
    type TEXT NOT NULL,
    source TEXT NOT NULL,
    subject TEXT,
    data TEXT NOT NULL,
    metadata TEXT NOT NULL,
    embedding BLOB
  );

  CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
  CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
  CREATE INDEX IF NOT EXISTS idx_events_source ON events(source);
  CREATE INDEX IF NOT EXISTS idx_events_subject ON events(subject);

  CREATE VIRTUAL TABLE IF NOT EXISTS events_fts USING fts5(
    id,
    type,
    source,
    subject,
    data,
    content='events',
    content_rowid='rowid'
  );

  CREATE TRIGGER IF NOT EXISTS events_ai AFTER INSERT ON events BEGIN
    INSERT INTO events_fts(rowid, id, type, source, subject, data)
    VALUES (new.rowid, new.id, new.type, new.source, new.subject, new.data);
  END;

  CREATE TRIGGER IF NOT EXISTS events_ad AFTER DELETE ON events BEGIN
    INSERT INTO events_fts(events_fts, rowid, id, type, source, subject, data)
    VALUES ('delete', old.rowid, old.id, old.type, old.source, old.subject, old.data);
  END;

  CREATE TRIGGER IF NOT EXISTS events_au AFTER UPDATE ON events BEGIN
    INSERT INTO events_fts(events_fts, rowid, id, type, source, subject, data)
    VALUES ('delete', old.rowid, old.id, old.type, old.source, old.subject, old.data);
    INSERT INTO events_fts(rowid, id, type, source, subject, data)
    VALUES (new.rowid, new.id, new.type, new.source, new.subject, new.data);
  END;
`;

interface SubscriptionEntry {
  id: string;
  filter: EventFilter;
  handler: EventHandler;
}

export interface EventStoreOptions {
  dbPath?: string;
}

export class EventStore implements EventBus {
  private db: Database.Database;
  private subscriptions: Map<string, SubscriptionEntry> = new Map();
  private insertStmt: Database.Statement;
  private batchInsertStmt: Database.Transaction<(envelopes: Envelope[]) => void>;

  constructor(options: EventStoreOptions = {}) {
    const dbPath = options.dbPath ?? ":memory:";
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA);

    this.insertStmt = this.db.prepare(`
      INSERT INTO events (id, timestamp, type, source, subject, data, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    this.batchInsertStmt = this.db.transaction((envelopes: Envelope[]) => {
      for (const env of envelopes) {
        this.insertStmt.run(
          env.id,
          env.timestamp,
          env.type,
          env.source,
          env.subject ?? null,
          JSON.stringify(env.data),
          JSON.stringify(env.metadata)
        );
      }
    });
  }

  async publish(envelope: Envelope): Promise<void> {
    this.insertStmt.run(
      envelope.id,
      envelope.timestamp,
      envelope.type,
      envelope.source,
      envelope.subject ?? null,
      JSON.stringify(envelope.data),
      JSON.stringify(envelope.metadata)
    );

    await this.notifySubscribers(envelope);
  }

  async publishBatch(envelopes: Envelope[]): Promise<void> {
    this.batchInsertStmt(envelopes);

    for (const envelope of envelopes) {
      await this.notifySubscribers(envelope);
    }
  }

  subscribe(filter: EventFilter, handler: EventHandler): Subscription {
    const id = uuidv7();
    this.subscriptions.set(id, { id, filter, handler });

    return {
      id,
      unsubscribe: () => {
        this.subscriptions.delete(id);
      },
    };
  }

  async *stream(filter: EventFilter): AsyncIterable<Envelope> {
    const seen = new Set<string>();
    let lastTimestamp = filter.since ?? new Date(0).toISOString();

    while (true) {
      const events = await this.query(
        { ...filter, since: lastTimestamp },
        { limit: 100, order: "asc" }
      );

      for (const event of events) {
        if (!seen.has(event.id)) {
          seen.add(event.id);
          lastTimestamp = event.timestamp;
          yield event;
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  async query(
    filter: EventFilter,
    options: QueryOptions = {}
  ): Promise<Envelope[]> {
    const { limit = 100, offset = 0, order = "desc" } = options;
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.types?.length) {
      const placeholders = filter.types.map(() => "?").join(", ");
      conditions.push(`type IN (${placeholders})`);
      params.push(...filter.types);
    }

    if (filter.sources?.length) {
      const placeholders = filter.sources.map(() => "?").join(", ");
      conditions.push(`source IN (${placeholders})`);
      params.push(...filter.sources);
    }

    if (filter.subjects?.length) {
      const placeholders = filter.subjects.map(() => "?").join(", ");
      conditions.push(`subject IN (${placeholders})`);
      params.push(...filter.subjects);
    }

    if (filter.since) {
      conditions.push("timestamp >= ?");
      params.push(filter.since);
    }

    if (filter.until) {
      conditions.push("timestamp <= ?");
      params.push(filter.until);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const sql = `
      SELECT id, timestamp, type, source, subject, data, metadata
      FROM events
      ${whereClause}
      ORDER BY timestamp ${order.toUpperCase()}
      LIMIT ? OFFSET ?
    `;

    params.push(limit, offset);

    const rows = this.db.prepare(sql).all(...params) as Array<{
      id: string;
      timestamp: string;
      type: string;
      source: string;
      subject: string | null;
      data: string;
      metadata: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      timestamp: row.timestamp,
      type: row.type,
      source: row.source,
      subject: row.subject ?? undefined,
      data: JSON.parse(row.data),
      metadata: JSON.parse(row.metadata),
    }));
  }

  async search(query: string, options: QueryOptions = {}): Promise<Envelope[]> {
    const { limit = 100, offset = 0 } = options;

    const sql = `
      SELECT e.id, e.timestamp, e.type, e.source, e.subject, e.data, e.metadata
      FROM events e
      JOIN events_fts f ON e.id = f.id
      WHERE events_fts MATCH ?
      ORDER BY rank
      LIMIT ? OFFSET ?
    `;

    const rows = this.db.prepare(sql).all(query, limit, offset) as Array<{
      id: string;
      timestamp: string;
      type: string;
      source: string;
      subject: string | null;
      data: string;
      metadata: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      timestamp: row.timestamp,
      type: row.type,
      source: row.source,
      subject: row.subject ?? undefined,
      data: JSON.parse(row.data),
      metadata: JSON.parse(row.metadata),
    }));
  }

  async setEmbedding(eventId: string, embedding: Float32Array): Promise<void> {
    const buffer = Buffer.from(embedding.buffer);
    this.db
      .prepare("UPDATE events SET embedding = ? WHERE id = ?")
      .run(buffer, eventId);
  }

  async getEmbedding(eventId: string): Promise<Float32Array | null> {
    const row = this.db
      .prepare("SELECT embedding FROM events WHERE id = ?")
      .get(eventId) as { embedding: Buffer | null } | undefined;

    if (!row?.embedding) return null;

    return new Float32Array(row.embedding.buffer);
  }

  private async notifySubscribers(envelope: Envelope): Promise<void> {
    for (const sub of this.subscriptions.values()) {
      if (this.matchesFilter(envelope, sub.filter)) {
        try {
          await sub.handler(envelope);
        } catch (error) {
          console.error(`Subscription ${sub.id} handler error:`, error);
        }
      }
    }
  }

  private matchesFilter(envelope: Envelope, filter: EventFilter): boolean {
    if (filter.types?.length) {
      const matches = filter.types.some((pattern) => {
        if (pattern.endsWith(".*")) {
          return envelope.type.startsWith(pattern.slice(0, -2));
        }
        return envelope.type === pattern;
      });
      if (!matches) return false;
    }

    if (filter.sources?.length) {
      const matches = filter.sources.some((pattern) => {
        if (pattern.endsWith("*")) {
          return envelope.source.startsWith(pattern.slice(0, -1));
        }
        return envelope.source === pattern;
      });
      if (!matches) return false;
    }

    if (filter.subjects?.length) {
      if (!envelope.subject) return false;
      const matches = filter.subjects.some((pattern) => {
        if (pattern.endsWith("*")) {
          return envelope.subject?.startsWith(pattern.slice(0, -1));
        }
        return envelope.subject === pattern;
      });
      if (!matches) return false;
    }

    if (filter.since && envelope.timestamp < filter.since) return false;
    if (filter.until && envelope.timestamp > filter.until) return false;

    return true;
  }

  close(): void {
    this.db.close();
  }
}

export function createEnvelope(
  type: string,
  source: string,
  data: unknown,
  options: {
    subject?: string;
    metadata?: Record<string, unknown>;
  } = {}
): Envelope {
  return {
    id: uuidv7(),
    timestamp: new Date().toISOString(),
    type,
    source,
    subject: options.subject,
    data,
    metadata: options.metadata ?? {},
  };
}
