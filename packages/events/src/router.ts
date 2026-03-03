import { v7 as uuidv7 } from "uuid";
import type {
  Envelope,
  EventBus,
  EventFilter,
  EventHandler,
  QueryOptions,
  Subscription,
} from "./types.js";
import { EventStore, type EventStoreOptions } from "./store.js";

interface DeadLetterEntry {
  envelope: Envelope;
  subscriptionId: string;
  error: string;
  attempts: number;
  lastAttempt: string;
}

interface SubscriptionEntry {
  id: string;
  filter: EventFilter;
  handler: EventHandler;
  maxRetries: number;
  retryDelayMs: number;
}

export interface EventRouterOptions extends EventStoreOptions {
  maxRetries?: number;
  retryDelayMs?: number;
  deadLetterHandler?: (entry: DeadLetterEntry) => Promise<void>;
}

export class EventRouter implements EventBus {
  private store: EventStore;
  private subscriptions: Map<string, SubscriptionEntry> = new Map();
  private deadLetterQueue: Map<string, DeadLetterEntry> = new Map();
  private maxRetries: number;
  private retryDelayMs: number;
  private deadLetterHandler?: (entry: DeadLetterEntry) => Promise<void>;
  private pendingDeliveries: Map<string, Set<string>> = new Map();

  constructor(options: EventRouterOptions = {}) {
    this.store = new EventStore(options);
    this.maxRetries = options.maxRetries ?? 3;
    this.retryDelayMs = options.retryDelayMs ?? 1000;
    this.deadLetterHandler = options.deadLetterHandler;
  }

  async publish(envelope: Envelope): Promise<void> {
    await this.store.publish(envelope);
    await this.deliverToSubscribers(envelope);
  }

  async publishBatch(envelopes: Envelope[]): Promise<void> {
    await this.store.publishBatch(envelopes);
    for (const envelope of envelopes) {
      await this.deliverToSubscribers(envelope);
    }
  }

  subscribe(
    filter: EventFilter,
    handler: EventHandler,
    options?: { maxRetries?: number; retryDelayMs?: number }
  ): Subscription {
    const id = uuidv7();
    this.subscriptions.set(id, {
      id,
      filter,
      handler,
      maxRetries: options?.maxRetries ?? this.maxRetries,
      retryDelayMs: options?.retryDelayMs ?? this.retryDelayMs,
    });

    return {
      id,
      unsubscribe: () => {
        this.subscriptions.delete(id);
      },
    };
  }

  async *stream(filter: EventFilter): AsyncIterable<Envelope> {
    yield* this.store.stream(filter);
  }

  async query(
    filter: EventFilter,
    options?: QueryOptions
  ): Promise<Envelope[]> {
    return this.store.query(filter, options);
  }

  getDeadLetterQueue(): DeadLetterEntry[] {
    return Array.from(this.deadLetterQueue.values());
  }

  async retryDeadLetter(key: string): Promise<boolean> {
    const entry = this.deadLetterQueue.get(key);
    if (!entry) return false;

    const sub = this.subscriptions.get(entry.subscriptionId);
    if (!sub) {
      this.deadLetterQueue.delete(key);
      return false;
    }

    try {
      await sub.handler(entry.envelope);
      this.deadLetterQueue.delete(key);
      return true;
    } catch (error) {
      entry.attempts++;
      entry.lastAttempt = new Date().toISOString();
      entry.error = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  async clearDeadLetterQueue(): Promise<number> {
    const count = this.deadLetterQueue.size;
    this.deadLetterQueue.clear();
    return count;
  }

  private async deliverToSubscribers(envelope: Envelope): Promise<void> {
    for (const sub of this.subscriptions.values()) {
      if (this.matchesFilter(envelope, sub.filter)) {
        await this.deliverWithRetry(envelope, sub);
      }
    }
  }

  private async deliverWithRetry(
    envelope: Envelope,
    sub: SubscriptionEntry
  ): Promise<void> {
    const deliveryKey = `${envelope.id}:${sub.id}`;

    let pending = this.pendingDeliveries.get(envelope.id);
    if (!pending) {
      pending = new Set();
      this.pendingDeliveries.set(envelope.id, pending);
    }
    pending.add(sub.id);

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= sub.maxRetries; attempt++) {
      try {
        await sub.handler(envelope);
        pending.delete(sub.id);
        if (pending.size === 0) {
          this.pendingDeliveries.delete(envelope.id);
        }
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < sub.maxRetries) {
          await this.delay(sub.retryDelayMs * Math.pow(2, attempt));
        }
      }
    }

    pending.delete(sub.id);
    if (pending.size === 0) {
      this.pendingDeliveries.delete(envelope.id);
    }

    const entry: DeadLetterEntry = {
      envelope,
      subscriptionId: sub.id,
      error: lastError?.message ?? "Unknown error",
      attempts: sub.maxRetries + 1,
      lastAttempt: new Date().toISOString(),
    };

    this.deadLetterQueue.set(deliveryKey, entry);

    if (this.deadLetterHandler) {
      try {
        await this.deadLetterHandler(entry);
      } catch (handlerError) {
        console.error("Dead letter handler error:", handlerError);
      }
    }
  }

  private matchesFilter(envelope: Envelope, filter: EventFilter): boolean {
    if (filter.types?.length) {
      const matches = filter.types.some((pattern) =>
        this.matchPattern(envelope.type, pattern)
      );
      if (!matches) return false;
    }

    if (filter.sources?.length) {
      const matches = filter.sources.some((pattern) =>
        this.matchPattern(envelope.source, pattern)
      );
      if (!matches) return false;
    }

    if (filter.subjects?.length) {
      if (!envelope.subject) return false;
      const matches = filter.subjects.some((pattern) =>
        this.matchPattern(envelope.subject!, pattern)
      );
      if (!matches) return false;
    }

    if (filter.since && envelope.timestamp < filter.since) return false;
    if (filter.until && envelope.timestamp > filter.until) return false;

    return true;
  }

  private matchPattern(value: string, pattern: string): boolean {
    if (pattern === "*") return true;
    if (pattern.endsWith(".*")) {
      return value.startsWith(pattern.slice(0, -2));
    }
    if (pattern.endsWith("*")) {
      return value.startsWith(pattern.slice(0, -1));
    }
    return value === pattern;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  close(): void {
    this.store.close();
  }
}
