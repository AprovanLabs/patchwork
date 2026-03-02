import type { EventFilter, Envelope, Entity } from "@aprovan/apprentice";

export interface SkillDefinition {
  id: string;
  uri: string;
  name: string;
  description: string;
  instructions: string;
  resources: SkillResource[];
  triggers?: SkillTrigger[];
  tools?: string[];
  model?: ModelPreference;
  version?: string;
}

export interface SkillResource {
  path: string;
  type: "markdown" | "script" | "config" | "other";
  content?: string;
}

export interface SkillTrigger {
  eventFilter: EventFilter;
  condition?: string;
  priority?: number;
}

export interface ModelPreference {
  provider: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

export interface SkillContext {
  event: Envelope;
  entities: Entity[];
  services: string[];
  history?: Envelope[];
}

export interface SkillResult {
  skillId: string;
  success: boolean;
  output?: unknown;
  error?: string;
  duration: number;
  events: Envelope[];
}

export interface SkillSummary {
  id: string;
  name: string;
  description: string;
  triggerCount: number;
  toolCount: number;
}

export interface SkillRegistry {
  register(skill: SkillDefinition): Promise<void>;
  unregister(skillId: string): Promise<void>;
  get(skillId: string): Promise<SkillDefinition | null>;
  list(): Promise<SkillSummary[]>;
  search(query: string): Promise<SkillDefinition[]>;
  findByTrigger(event: Envelope): Promise<SkillDefinition[]>;
}

export interface SkillMetadata {
  name?: string;
  description?: string;
  triggers?: Array<{
    types?: string[];
    sources?: string[];
    subjects?: string[];
    condition?: string;
    priority?: number;
  }>;
  tools?: string[];
  model?: {
    provider?: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
  };
}
