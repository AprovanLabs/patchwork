import type { EventBus, Envelope } from "@aprovan/apprentice";
import { createEnvelope } from "@aprovan/apprentice";
import type {
  ServiceDefinition,
  ServiceRegistry,
  ServiceSummary,
  JsonSchema,
  ProcedureDefinition,
  StreamEvent,
} from "./types.js";
import { ServiceStore, type ServiceStoreOptions } from "./store.js";

export interface ServiceBackend {
  call(namespace: string, procedure: string, args: unknown): Promise<unknown>;
  stream?(
    namespace: string,
    procedure: string,
    args: unknown
  ): AsyncIterable<unknown>;
}

export interface PersistentServiceRegistryOptions extends ServiceStoreOptions {
  eventBus?: EventBus;
}

export class PersistentServiceRegistry implements ServiceRegistry {
  private store: ServiceStore;
  private backends: Map<string, ServiceBackend> = new Map();
  private eventBus?: EventBus;

  constructor(options: PersistentServiceRegistryOptions = {}) {
    this.store = new ServiceStore(options);
    this.eventBus = options.eventBus;

    if (this.eventBus) {
      this.eventBus.subscribe(
        { types: ["service.cache.invalidate"] },
        async (envelope: Envelope) => {
          const pattern = envelope.data as { pattern: string };
          if (pattern?.pattern) {
            await this.store.cacheInvalidate(pattern.pattern);
          }
        }
      );
    }
  }

  registerBackend(namespace: string, backend: ServiceBackend): void {
    this.backends.set(namespace, backend);
  }

  unregisterBackend(namespace: string): void {
    this.backends.delete(namespace);
  }

  async register(service: ServiceDefinition): Promise<void> {
    await this.store.register(service);

    if (this.eventBus) {
      await this.eventBus.publish(
        createEnvelope("service.registered", "service-registry", {
          namespace: service.namespace,
          version: service.version,
          procedures: service.procedures.map((p) => p.name),
        })
      );
    }
  }

  async unregister(namespace: string): Promise<void> {
    await this.store.unregister(namespace);
    await this.store.cacheInvalidate(`${namespace}:*`);

    if (this.eventBus) {
      await this.eventBus.publish(
        createEnvelope("service.unregistered", "service-registry", { namespace })
      );
    }
  }

  async get(
    namespace: string,
    version?: string
  ): Promise<ServiceDefinition | null> {
    return this.store.get(namespace, version);
  }

  async list(): Promise<ServiceSummary[]> {
    return this.store.list();
  }

  async listVersions(namespace: string): Promise<string[]> {
    return this.store.listVersions(namespace);
  }

  async search(query: string): Promise<ServiceDefinition[]> {
    return this.store.search(query);
  }

  async call<T = unknown>(
    namespace: string,
    procedure: string,
    args: unknown
  ): Promise<T> {
    const service = await this.store.get(namespace);
    const procDef = service?.procedures.find((p) => p.name === procedure);
    const cacheKey = `${namespace}:${procedure}:${JSON.stringify(args)}`;

    if (procDef?.cacheTtl) {
      const cached = await this.store.cacheGet(cacheKey);
      if (cached !== null) {
        return cached as T;
      }
    }

    const backend = this.backends.get(namespace);
    if (!backend) {
      throw new Error(`No backend registered for namespace: ${namespace}`);
    }

    const startTime = Date.now();
    try {
      const result = await backend.call(namespace, procedure, args);

      if (procDef?.cacheTtl) {
        await this.store.cacheSet(cacheKey, result, procDef.cacheTtl);
      }

      if (this.eventBus) {
        await this.eventBus.publish(
          createEnvelope("service.call.success", `service:${namespace}`, {
            namespace,
            procedure,
            durationMs: Date.now() - startTime,
          })
        );
      }

      return result as T;
    } catch (error) {
      if (this.eventBus) {
        await this.eventBus.publish(
          createEnvelope("service.call.error", `service:${namespace}`, {
            namespace,
            procedure,
            error: error instanceof Error ? error.message : String(error),
            durationMs: Date.now() - startTime,
          })
        );
      }
      throw error;
    }
  }

  async *stream<T = unknown>(
    namespace: string,
    procedure: string,
    args: unknown
  ): AsyncIterable<T> {
    const backend = this.backends.get(namespace);
    if (!backend) {
      throw new Error(`No backend registered for namespace: ${namespace}`);
    }

    if (!backend.stream) {
      throw new Error(`Backend ${namespace} does not support streaming`);
    }

    const service = await this.store.get(namespace);
    const procDef = service?.procedures.find((p) => p.name === procedure);

    if (procDef && !procDef.streaming) {
      throw new Error(`Procedure ${namespace}.${procedure} does not support streaming`);
    }

    if (this.eventBus) {
      await this.eventBus.publish(
        createEnvelope("service.stream.start", `service:${namespace}`, {
          namespace,
          procedure,
        })
      );
    }

    try {
      for await (const chunk of backend.stream(namespace, procedure, args)) {
        if (this.eventBus) {
          await this.eventBus.publish(
            createEnvelope("service.stream.data", `service:${namespace}`, {
              namespace,
              procedure,
              data: chunk,
            })
          );
        }
        yield chunk as T;
      }

      if (this.eventBus) {
        await this.eventBus.publish(
          createEnvelope("service.stream.complete", `service:${namespace}`, {
            namespace,
            procedure,
          })
        );
      }
    } catch (error) {
      if (this.eventBus) {
        await this.eventBus.publish(
          createEnvelope("service.stream.error", `service:${namespace}`, {
            namespace,
            procedure,
            error: error instanceof Error ? error.message : String(error),
          })
        );
      }
      throw error;
    }
  }

  async getSchema(
    namespace: string,
    typeName: string
  ): Promise<JsonSchema | null> {
    return this.store.getSchema(namespace, typeName);
  }

  async invalidateCache(pattern: string): Promise<void> {
    await this.store.cacheInvalidate(pattern);

    if (this.eventBus) {
      await this.eventBus.publish(
        createEnvelope("service.cache.invalidate", "service-registry", {
          pattern,
        })
      );
    }
  }

  extractTypes(service: ServiceDefinition): void {
    for (const proc of service.procedures) {
      if (proc.input.schema && !service.types.find((t) => t.name === proc.input.name)) {
        service.types.push({
          name: proc.input.name,
          schema: proc.input.schema,
        });
      }
      if (proc.output.schema && !service.types.find((t) => t.name === proc.output.name)) {
        service.types.push({
          name: proc.output.name,
          schema: proc.output.schema,
        });
      }
    }
  }

  close(): void {
    this.store.close();
  }
}

export function createStreamAdapter<T>(
  readable: ReadableStream<T>
): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      const reader = readable.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          yield value;
        }
      } finally {
        reader.releaseLock();
      }
    },
  };
}

export function parseSSEStream(readable: ReadableStream<Uint8Array>): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      const reader = readable.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6).trim();
              if (data === "[DONE]") return;
              try {
                yield JSON.parse(data);
              } catch {
                yield data;
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    },
  };
}
