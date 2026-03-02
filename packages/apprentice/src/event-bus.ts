import type Database from "better-sqlite3";
import { v4 as uuid } from "uuid";
import type { Envelope, EventFilter, EventHandler, EventBus, Subscription, QueryOptions } from "./types.js";

interface SubscriptionEntry {
  id: string;
  filter: EventFilter;
  handler: EventHandler;
}

export interface EventBusOptions {
  db: Database.Database;
}

export class EventBusImpl implements EventBus {
  private db: Database.Database;
  private subscriptions: Map<string, SubscriptionEntry> = new Map();

  constructor(options: EventBusOptions) {
    this.db = options.db;
  }

  async publish(envelope: Envelope): Promise<void> {
    this.db
      .prepare(`
        INSERT INTO events (id, timestamp, type, source, subject, data, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        envelope.id,
        envelope.timestamp,
        envelope.type,
        envelope.source,
        envelope.subject ?? null,
        JSON.stringify(envelope.data),
        JSON.stringify(envelope.metadata)
      );

    for (const sub of this.subscriptions.values()) {
      if (this.matchesFilter(envelope, sub.filter)) {
        await sub.handler(envelope);
      }
    }
  }

  async publishBatch(envelopes: Envelope[]): Promise<void> {
    const transaction = this.db.transaction(() => {
      for (const envelope of envelopes) {
        this.db
          .prepare(`
            INSERT INTO events (id, timestamp, type, source, subject, data, metadata)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `)
          .run(
            envelope.id,
            envelope.timestamp,
            envelope.type,
            envelope.source,
            envelope.subject ?? null,
            JSON.stringify(envelope.data),
            JSON.stringify(envelope.metadata)
          );
      }
    });

    transaction();

    for (const envelope of envelopes) {
      for (const sub of this.subscriptions.values()) {
        if (this.matchesFilter(envelope, sub.filter)) {
          await sub.handler(envelope);
        }
      }
    }
  }

  subscribe(filter: EventFilter, handler: EventHandler): Subscription {
    const id = uuid();
    const entry: SubscriptionEntry = { id, filter, handler };
    this.subscriptions.set(id, entry);

    return {
      id,
      filter,
      unsubscribe: () => {
        this.subscriptions.delete(id);
      },
    };
  }

  async query(filter: EventFilter, options: QueryOptions = {}): Promise<Envelope[]> {
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
      const subjectConditions = filter.subjects.map((s) => {
        if (s.endsWith("*")) {
          params.push(s.slice(0, -1) + "%");
          return "subject LIKE ?";
        }
        params.push(s);
        return "subject = ?";
      });
      conditions.push(`(${subjectConditions.join(" OR ")})`);
    }

    if (filter.since) {
      conditions.push("timestamp >= ?");
      params.push(filter.since);
    }

    if (filter.until) {
      conditions.push("timestamp <= ?");
      params.push(filter.until);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const order = options.order === "asc" ? "ASC" : "DESC";
    const limit = options.limit ?? 100;
    const offset = options.offset ?? 0;

    const rows = this.db
      .prepare(`SELECT * FROM events ${whereClause} ORDER BY timestamp ${order} LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as Record<string, unknown>[];

    return rows.map((row) => ({
      id: row.id as string,
      timestamp: row.timestamp as string,
      type: row.type as string,
      source: row.source as string,
      subject: row.subject as string | undefined,
      data: JSON.parse(row.data as string),
      metadata: JSON.parse(row.metadata as string),
    }));
  }

  getSubscriptions(): Subscription[] {
    return Array.from(this.subscriptions.values()).map((entry) => ({
      id: entry.id,
      filter: entry.filter,
      unsubscribe: () => this.subscriptions.delete(entry.id),
    }));
  }

  private matchesFilter(envelope: Envelope, filter: EventFilter): boolean {
    if (filter.types?.length && !this.matchesPattern(envelope.type, filter.types)) {
      return false;
    }

    if (filter.sources?.length && !this.matchesPattern(envelope.source, filter.sources)) {
      return false;
    }

    if (filter.subjects?.length) {
      if (!envelope.subject) return false;
      if (!this.matchesPattern(envelope.subject, filter.subjects)) {
        return false;
      }
    }

    if (filter.since && envelope.timestamp < filter.since) {
      return false;
    }

    if (filter.until && envelope.timestamp > filter.until) {
      return false;
    }

    return true;
  }

  private matchesPattern(value: string, patterns: string[]): boolean {
    for (const pattern of patterns) {
      if (pattern.endsWith("*")) {
        const prefix = pattern.slice(0, -1);
        if (value.startsWith(prefix)) return true;
      } else if (pattern === value) {
        return true;
      }
    }
    return false;
  }
}

export function createEnvelope(
  type: string,
  source: string,
  data: unknown,
  options: { subject?: string; metadata?: Record<string, unknown> } = {}
): Envelope {
  return {
    id: uuid(),
    timestamp: new Date().toISOString(),
    type,
    source,
    subject: options.subject,
    data,
    metadata: options.metadata ?? {},
  };
}
