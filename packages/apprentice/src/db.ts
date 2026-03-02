import Database from "better-sqlite3";

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS entities (
    uri TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    attrs TEXT NOT NULL DEFAULT '{}',
    version TEXT,
    synced_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
  CREATE INDEX IF NOT EXISTS idx_entities_scheme ON entities(substr(uri, 1, instr(uri, ':') - 1));

  CREATE TABLE IF NOT EXISTS entity_versions (
    uri TEXT NOT NULL,
    version TEXT NOT NULL,
    attrs TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (uri, version)
  );

  CREATE TABLE IF NOT EXISTS entity_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_uri TEXT NOT NULL,
    to_uri TEXT NOT NULL,
    type TEXT NOT NULL,
    attrs TEXT,
    UNIQUE(from_uri, to_uri, type)
  );

  CREATE INDEX IF NOT EXISTS idx_entity_links_from ON entity_links(from_uri);
  CREATE INDEX IF NOT EXISTS idx_entity_links_to ON entity_links(to_uri);
  CREATE INDEX IF NOT EXISTS idx_entity_links_type ON entity_links(type);

  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    timestamp TEXT NOT NULL,
    type TEXT NOT NULL,
    source TEXT NOT NULL,
    subject TEXT,
    data TEXT NOT NULL DEFAULT '{}',
    metadata TEXT NOT NULL DEFAULT '{}'
  );

  CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
  CREATE INDEX IF NOT EXISTS idx_events_source ON events(source);
  CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    metadata TEXT NOT NULL DEFAULT '{}'
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
`;

export interface DatabaseOptions {
  path?: string;
}

export function createDatabase(options: DatabaseOptions = {}): Database.Database {
  const dbPath = options.path ?? ":memory:";
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}
