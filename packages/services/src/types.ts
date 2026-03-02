export interface ServiceDefinition {
  namespace: string;
  version: string;
  source: ServiceSource;
  procedures: ProcedureDefinition[];
  types: TypeDefinition[];
  registeredAt?: string;
  updatedAt?: string;
}

export interface ServiceSource {
  type: "mcp" | "http" | "local";
  config: Record<string, unknown>;
}

export interface ProcedureDefinition {
  name: string;
  description: string;
  input: TypeReference;
  output: TypeReference;
  streaming?: boolean;
  cacheTtl?: number;
}

export interface TypeReference {
  name: string;
  schema?: JsonSchema;
}

export interface TypeDefinition {
  name: string;
  schema: JsonSchema;
}

export interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  description?: string;
  enum?: unknown[];
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  $ref?: string;
  [key: string]: unknown;
}

export interface ServiceSummary {
  namespace: string;
  version: string;
  procedureCount: number;
  typeCount: number;
  sourceType: string;
}

export interface CacheEntry {
  key: string;
  value: unknown;
  expiresAt: number;
  etag?: string;
  lastModified?: string;
}

export interface CacheConfig {
  defaultTtl: number;
  maxEntries: number;
}

export interface ServiceRegistry {
  register(service: ServiceDefinition): Promise<void>;
  unregister(namespace: string): Promise<void>;
  get(namespace: string, version?: string): Promise<ServiceDefinition | null>;
  list(): Promise<ServiceSummary[]>;
  listVersions(namespace: string): Promise<string[]>;
  search(query: string): Promise<ServiceDefinition[]>;
  call<T = unknown>(namespace: string, procedure: string, args: unknown): Promise<T>;
  stream<T = unknown>(namespace: string, procedure: string, args: unknown): AsyncIterable<T>;
  getSchema(namespace: string, typeName: string): Promise<JsonSchema | null>;
}

export interface StreamEvent<T = unknown> {
  type: "data" | "error" | "complete";
  data?: T;
  error?: string;
}
