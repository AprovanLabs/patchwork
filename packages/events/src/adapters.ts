import { v7 as uuidv7 } from "uuid";
import type { Envelope, EventBus } from "./types.js";

export interface WebhookConfig {
  provider: string;
  extractType?: (payload: unknown) => string;
  extractSubject?: (payload: unknown) => string | undefined;
  extractMetadata?: (payload: unknown) => Record<string, unknown>;
}

export function createWebhookAdapter(bus: EventBus, config: WebhookConfig) {
  const defaultExtractType = (payload: unknown): string => {
    const p = payload as Record<string, unknown>;
    if (p.action && typeof p.action === "string") {
      return `${config.provider}.${p.action}`;
    }
    return `${config.provider}.webhook`;
  };

  return async (payload: unknown): Promise<Envelope> => {
    const type = config.extractType?.(payload) ?? defaultExtractType(payload);
    const subject = config.extractSubject?.(payload);
    const metadata = config.extractMetadata?.(payload) ?? {};

    const envelope: Envelope = {
      id: uuidv7(),
      timestamp: new Date().toISOString(),
      type,
      source: `webhook:${config.provider}`,
      subject,
      data: payload,
      metadata: {
        ...metadata,
        webhook: { provider: config.provider },
      },
    };

    await bus.publish(envelope);
    return envelope;
  };
}

export interface ScheduleConfig {
  name: string;
  cronExpression: string;
  data?: unknown;
  metadata?: Record<string, unknown>;
}

export class ScheduleAdapter {
  private bus: EventBus;
  private schedules: Map<string, { config: ScheduleConfig; timer: ReturnType<typeof setInterval> | null }> = new Map();

  constructor(bus: EventBus) {
    this.bus = bus;
  }

  register(config: ScheduleConfig): void {
    if (this.schedules.has(config.name)) {
      this.unregister(config.name);
    }

    const intervalMs = this.cronToInterval(config.cronExpression);
    const timer = setInterval(() => this.trigger(config), intervalMs);

    this.schedules.set(config.name, { config, timer });
  }

  unregister(name: string): void {
    const entry = this.schedules.get(name);
    if (entry?.timer) {
      clearInterval(entry.timer);
    }
    this.schedules.delete(name);
  }

  async trigger(config: ScheduleConfig): Promise<Envelope> {
    const envelope: Envelope = {
      id: uuidv7(),
      timestamp: new Date().toISOString(),
      type: "schedule.triggered",
      source: `schedule:${config.name}`,
      data: config.data ?? {},
      metadata: {
        ...config.metadata,
        schedule: {
          name: config.name,
          cron: config.cronExpression,
        },
      },
    };

    await this.bus.publish(envelope);
    return envelope;
  }

  async triggerNow(name: string): Promise<Envelope | null> {
    const entry = this.schedules.get(name);
    if (!entry) return null;
    return this.trigger(entry.config);
  }

  list(): ScheduleConfig[] {
    return Array.from(this.schedules.values()).map((e) => e.config);
  }

  close(): void {
    for (const entry of this.schedules.values()) {
      if (entry.timer) {
        clearInterval(entry.timer);
      }
    }
    this.schedules.clear();
  }

  private cronToInterval(cron: string): number {
    const parts = cron.split(" ");
    if (parts[0] === "*") return 60 * 1000;
    if (parts[1] === "*") return 60 * 60 * 1000;
    if (parts[2] === "*") return 24 * 60 * 60 * 1000;
    return 60 * 1000;
  }
}

export interface ManualEventOptions {
  type: string;
  source?: string;
  subject?: string;
  data?: unknown;
  metadata?: Record<string, unknown>;
}

export function createManualAdapter(bus: EventBus) {
  return async (options: ManualEventOptions): Promise<Envelope> => {
    const envelope: Envelope = {
      id: uuidv7(),
      timestamp: new Date().toISOString(),
      type: options.type,
      source: options.source ?? "manual",
      subject: options.subject,
      data: options.data ?? {},
      metadata: options.metadata ?? {},
    };

    await bus.publish(envelope);
    return envelope;
  };
}

export interface WebhookInferrer {
  provider: string;
  inferType(body: unknown, headers: Record<string, string>): string | null;
  inferSubject(body: unknown, headers: Record<string, string>): string | undefined;
  inferMetadata?(body: unknown, headers: Record<string, string>): Record<string, unknown>;
}

class WebhookInferrerRegistryImpl {
  private inferrers: Map<string, WebhookInferrer> = new Map();

  register(inferrer: WebhookInferrer): void {
    this.inferrers.set(inferrer.provider, inferrer);
  }

  unregister(provider: string): void {
    this.inferrers.delete(provider);
  }

  get(provider: string): WebhookInferrer | undefined {
    return this.inferrers.get(provider);
  }

  infer(provider: string, body: unknown, headers: Record<string, string>): {
    type: string | null;
    subject: string | undefined;
    metadata: Record<string, unknown>;
  } {
    const inferrer = this.inferrers.get(provider);
    if (!inferrer) {
      return { type: null, subject: undefined, metadata: {} };
    }

    return {
      type: inferrer.inferType(body, headers),
      subject: inferrer.inferSubject(body, headers),
      metadata: inferrer.inferMetadata?.(body, headers) ?? {},
    };
  }

  listProviders(): string[] {
    return Array.from(this.inferrers.keys());
  }
}

export const WebhookInferrerRegistry = new WebhookInferrerRegistryImpl();

export function createProviderWebhookAdapter(bus: EventBus, provider: string) {
  return async (payload: unknown, headers: Record<string, string> = {}): Promise<Envelope> => {
    const inferred = WebhookInferrerRegistry.infer(provider, payload, headers);
    
    const envelope: Envelope = {
      id: uuidv7(),
      timestamp: new Date().toISOString(),
      type: inferred.type ?? `${provider}.webhook`,
      source: `webhook:${provider}`,
      subject: inferred.subject,
      data: payload,
      metadata: {
        ...inferred.metadata,
        webhook: { provider },
      },
    };

    await bus.publish(envelope);
    return envelope;
  };
}
