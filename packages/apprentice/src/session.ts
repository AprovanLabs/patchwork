import type Database from "better-sqlite3";
import { v4 as uuid } from "uuid";
import type { Session, SessionManager } from "./types.js";

export interface SessionManagerOptions {
  db: Database.Database;
}

export class SessionManagerImpl implements SessionManager {
  private db: Database.Database;

  constructor(options: SessionManagerOptions) {
    this.db = options.db;
  }

  async create(metadata: Record<string, unknown> = {}): Promise<Session> {
    const id = uuid();
    const now = new Date().toISOString();

    this.db
      .prepare(`
        INSERT INTO sessions (id, status, created_at, updated_at, metadata)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(id, "active", now, now, JSON.stringify(metadata));

    return {
      id,
      status: "active",
      createdAt: now,
      updatedAt: now,
      metadata,
    };
  }

  async get(id: string): Promise<Session | null> {
    const row = this.db
      .prepare("SELECT * FROM sessions WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;

    if (!row) return null;

    return {
      id: row.id as string,
      status: row.status as Session["status"],
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
      metadata: JSON.parse(row.metadata as string),
    };
  }

  async update(id: string, updates: Partial<Pick<Session, "status" | "metadata">>): Promise<void> {
    const existing = await this.get(id);
    if (!existing) return;

    const now = new Date().toISOString();
    const newStatus = updates.status ?? existing.status;
    const newMetadata = updates.metadata
      ? { ...existing.metadata, ...updates.metadata }
      : existing.metadata;

    this.db
      .prepare(`
        UPDATE sessions
        SET status = ?, metadata = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(newStatus, JSON.stringify(newMetadata), now, id);
  }

  async list(filter: { status?: Session["status"] } = {}): Promise<Session[]> {
    let query = "SELECT * FROM sessions";
    const params: unknown[] = [];

    if (filter.status) {
      query += " WHERE status = ?";
      params.push(filter.status);
    }

    query += " ORDER BY created_at DESC";

    const rows = this.db.prepare(query).all(...params) as Record<string, unknown>[];

    return rows.map((row) => ({
      id: row.id as string,
      status: row.status as Session["status"],
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
      metadata: JSON.parse(row.metadata as string),
    }));
  }

  async delete(id: string): Promise<void> {
    this.db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  }
}
