import type { Envelope, EventFilter } from "@patchwork/events";
import type { Entity } from "@patchwork/graph";
import type { SkillDefinition, SkillContext } from "@patchwork/skills";

export interface Session {
  id: string;
  skillId: string;
  status: SessionStatus;
  startedAt: string;
  completedAt?: string;
  events: Envelope[];
  result?: unknown;
  error?: string;
  parentSessionId?: string;
}

export type SessionStatus = "pending" | "running" | "complete" | "failed" | "cancelled";

export interface SessionConfig {
  skillId: string;
  model: ModelSpec;
  context: SkillContext;
  parentSessionId?: string;
}

export interface ModelSpec {
  provider: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

export interface LLMChunk {
  type: "text" | "tool_call" | "tool_result" | "error";
  content: string;
  toolName?: string;
  toolArgs?: unknown;
  toolResult?: unknown;
}

export interface LLMAdapter {
  complete(
    messages: LLMMessage[],
    options: LLMOptions
  ): AsyncIterable<LLMChunk>;
}

export interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  toolCallId?: string;
}

export interface LLMOptions {
  model: ModelSpec;
  tools?: LLMTool[];
  maxTokens?: number;
}

export interface LLMTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface OrchestratorConfig {
  defaultModel?: ModelSpec;
  maxConcurrentSessions?: number;
  sessionTimeoutMs?: number;
}

export interface ExecutionContext {
  session: Session;
  skill: SkillDefinition;
  entities: Entity[];
  services: string[];
}
