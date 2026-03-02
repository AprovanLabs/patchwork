export interface ParsedUri {
  scheme: string;
  path: string;
  fragment?: string;
  version?: string;
}

export interface Entity {
  uri: string;
  type: string;
  attrs: Record<string, unknown>;
  version?: string;
  syncedAt?: string;
}

export interface EntityLink {
  fromUri: string;
  toUri: string;
  type: string;
  attrs?: Record<string, unknown>;
}

export interface EntityFilter {
  types?: string[];
  schemes?: string[];
  uris?: string[];
  attrs?: Record<string, unknown>;
  limit?: number;
  offset?: number;
}

export interface EntityGraph {
  upsert(entity: Entity): Promise<void>;
  upsertBatch(entities: Entity[]): Promise<void>;
  get(uri: string, version?: string): Promise<Entity | null>;
  delete(uri: string): Promise<void>;
  link(fromUri: string, toUri: string, type: string, attrs?: Record<string, unknown>): Promise<void>;
  unlink(fromUri: string, toUri: string, type: string): Promise<void>;
  getLinks(uri: string, direction?: "outgoing" | "incoming" | "both"): Promise<EntityLink[]>;
  query(filter: EntityFilter): Promise<Entity[]>;
  traverse(uri: string, depth?: number): Promise<Entity[]>;
}

export interface Envelope {
  id: string;
  timestamp: string;
  type: string;
  source: string;
  subject?: string;
  data: unknown;
  metadata: Record<string, unknown>;
}

export interface EventFilter {
  types?: string[];
  sources?: string[];
  subjects?: string[];
  since?: string;
  until?: string;
  metadata?: Record<string, unknown>;
}

export interface QueryOptions {
  limit?: number;
  offset?: number;
  order?: "asc" | "desc";
}

export interface Subscription {
  id: string;
  filter: EventFilter;
  unsubscribe(): void;
}

export type EventHandler = (envelope: Envelope) => void | Promise<void>;

export interface EventBus {
  publish(envelope: Envelope): Promise<void>;
  publishBatch(envelopes: Envelope[]): Promise<void>;
  subscribe(filter: EventFilter, handler: EventHandler): Subscription;
  query(filter: EventFilter, options?: QueryOptions): Promise<Envelope[]>;
}

export interface Session {
  id: string;
  status: "active" | "paused" | "completed" | "failed";
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
}

export interface SessionManager {
  create(metadata?: Record<string, unknown>): Promise<Session>;
  get(id: string): Promise<Session | null>;
  update(id: string, updates: Partial<Pick<Session, "status" | "metadata">>): Promise<void>;
  list(filter?: { status?: Session["status"] }): Promise<Session[]>;
}

export interface SkillTrigger {
  type: string;
  condition?: Record<string, unknown>;
}

export interface SkillResolver {
  resolve(envelope: Envelope): Promise<string | null>;
}

export interface ToolExecutor {
  execute(name: string, args: Record<string, unknown>, context: { sessionId: string }): Promise<unknown>;
}

export interface OrchestratorConfig {
  maxConcurrent?: number;
  skillResolver?: SkillResolver;
  toolExecutor?: ToolExecutor;
}

export interface Orchestrator {
  start(sessionId: string, envelope: Envelope): Promise<void>;
  pause(sessionId: string): Promise<void>;
  resume(sessionId: string): Promise<void>;
  cancel(sessionId: string): Promise<void>;
}

export interface ExternalNotifier {
  notify(event: Envelope): Promise<void>;
}
