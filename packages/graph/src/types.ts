export interface Entity {
  uri: string;
  type: string;
  attrs: Record<string, unknown>;
  version?: string;
  syncedAt?: string;
  links?: EntityLink[];
}

export interface EntityLink {
  type: string;
  targetUri: string;
  attrs?: Record<string, unknown>;
}

export interface ParsedUri {
  scheme: string;
  path: string;
  fragment?: string;
  version?: string;
}

export interface LinkExtractor {
  patterns: RegExp[];
  extract(content: string, sourceUri: string): EntityLink[];
}

export interface ViewDefinition {
  name: string;
  query: string;
  path: string;
  format: "markdown" | "json" | "yaml";
  template?: string;
  ttl?: number;
}

export interface ViewResult {
  name: string;
  path: string;
  content: string;
  entities: Entity[];
  generatedAt: string;
}

export interface EntityGraph {
  upsert(entity: Entity): Promise<void>;
  upsertBatch(entities: Entity[]): Promise<void>;
  get(uri: string, version?: string): Promise<Entity | null>;
  delete(uri: string): Promise<void>;
  link(fromUri: string, toUri: string, type: string, attrs?: Record<string, unknown>): Promise<void>;
  unlink(fromUri: string, toUri: string, type: string): Promise<void>;
  query(filter: EntityFilter): Promise<Entity[]>;
  traverse(uri: string, depth?: number): Promise<Entity[]>;
  inferSchema(type: string): Promise<Record<string, unknown>>;
  getTypes(): Promise<string[]>;
}

export interface EntityFilter {
  types?: string[];
  uris?: string[];
  attrs?: Record<string, unknown>;
  limit?: number;
  offset?: number;
}
