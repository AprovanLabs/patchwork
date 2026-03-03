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
  unsubscribe(): void;
}

export type EventHandler = (envelope: Envelope) => Promise<void>;

export interface EventBus {
  publish(envelope: Envelope): Promise<void>;
  publishBatch(envelopes: Envelope[]): Promise<void>;
  subscribe(filter: EventFilter, handler: EventHandler): Subscription;
  stream(filter: EventFilter): AsyncIterable<Envelope>;
  query(filter: EventFilter, options?: QueryOptions): Promise<Envelope[]>;
}

export interface BatchConfig {
  maxSize: number;
  maxWaitMs: number;
  dedupeKey?: (e: Envelope) => string;
}
