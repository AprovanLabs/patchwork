import type { EventBus, Envelope, Subscription } from "@patchwork/events";
import { createEnvelope } from "@patchwork/events";
import type { EntityStore } from "@patchwork/graph";
import type { PersistentServiceRegistry } from "@patchwork/services";
import type { PersistentSkillRegistry, SkillDefinition, SkillContext, SkillResult } from "@patchwork/skills";
import type {
  Session,
  SessionConfig,
  ModelSpec,
  LLMAdapter,
  LLMChunk,
  OrchestratorConfig,
} from "./types.js";
import { SessionManager } from "./session.js";

export interface OrchestratorOptions {
  eventBus: EventBus;
  entityStore: EntityStore;
  serviceRegistry: PersistentServiceRegistry;
  skillRegistry: PersistentSkillRegistry;
  llmAdapter?: LLMAdapter;
  config?: OrchestratorConfig;
}

export class Orchestrator {
  private eventBus: EventBus;
  private entityStore: EntityStore;
  private serviceRegistry: PersistentServiceRegistry;
  private skillRegistry: PersistentSkillRegistry;
  private llmAdapter?: LLMAdapter;
  private sessionManager: SessionManager;
  private subscription?: Subscription;
  private defaultModel: ModelSpec;

  constructor(options: OrchestratorOptions) {
    this.eventBus = options.eventBus;
    this.entityStore = options.entityStore;
    this.serviceRegistry = options.serviceRegistry;
    this.skillRegistry = options.skillRegistry;
    this.llmAdapter = options.llmAdapter;

    this.sessionManager = new SessionManager({
      eventBus: this.eventBus,
      maxConcurrent: options.config?.maxConcurrentSessions,
      timeoutMs: options.config?.sessionTimeoutMs,
    });

    this.defaultModel = options.config?.defaultModel ?? {
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
    };
  }

  start(): void {
    this.subscription = this.eventBus.subscribe(
      { types: ["*"] },
      async (envelope) => {
        await this.handleEvent(envelope);
      }
    );
  }

  stop(): void {
    this.subscription?.unsubscribe();
  }

  async handleEvent(envelope: Envelope): Promise<void> {
    if (envelope.type.startsWith("llm.") || envelope.type.startsWith("orchestrator.")) {
      return;
    }

    const matchingSkills = await this.skillRegistry.findByTrigger(envelope);

    for (const skill of matchingSkills) {
      try {
        await this.executeSkill(skill, envelope);
      } catch (error) {
        console.error(`Failed to execute skill ${skill.id}:`, error);
      }
    }
  }

  async executeSkill(skill: SkillDefinition, triggerEvent: Envelope): Promise<Session> {
    const context = await this.buildContext(skill, triggerEvent);
    const model = skill.model ?? this.defaultModel;

    const config: SessionConfig = {
      skillId: skill.id,
      model,
      context,
    };

    const session = await this.sessionManager.create(config);

    this.runSession(session, skill, context).catch((error) => {
      console.error(`Session ${session.id} failed:`, error);
    });

    return session;
  }

  async startSession(config: SessionConfig): Promise<Session> {
    const skill = await this.skillRegistry.get(config.skillId);
    if (!skill) {
      throw new Error(`Skill not found: ${config.skillId}`);
    }

    const session = await this.sessionManager.create(config);

    this.runSession(session, skill, config.context).catch((error) => {
      console.error(`Session ${session.id} failed:`, error);
    });

    return session;
  }

  getSession(sessionId: string): Session | null {
    return this.sessionManager.get(sessionId);
  }

  async cancelSession(sessionId: string): Promise<void> {
    await this.sessionManager.cancel(sessionId);
  }

  private async runSession(
    session: Session,
    skill: SkillDefinition,
    context: SkillContext
  ): Promise<void> {
    await this.sessionManager.start(session.id);

    if (!this.llmAdapter) {
      await this.sessionManager.fail(session.id, "No LLM adapter configured");
      return;
    }

    try {
      const messages = this.buildMessages(skill, context);
      const tools = await this.buildTools(skill);

      const stream = this.llmAdapter.complete(messages, {
        model: skill.model ?? this.defaultModel,
        tools,
      });

      let result: unknown;
      for await (const chunk of stream) {
        await this.handleChunk(session.id, chunk);

        if (chunk.type === "tool_call" && chunk.toolName && chunk.toolArgs) {
          const toolResult = await this.executeToolCall(
            chunk.toolName,
            chunk.toolArgs
          );
          await this.handleChunk(session.id, {
            type: "tool_result",
            content: JSON.stringify(toolResult),
            toolName: chunk.toolName,
            toolResult,
          });
        }

        if (chunk.type === "text") {
          result = chunk.content;
        }
      }

      await this.sessionManager.complete(session.id, result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.sessionManager.fail(session.id, errorMessage);
    }
  }

  private async handleChunk(sessionId: string, chunk: LLMChunk): Promise<void> {
    const eventType = `llm.${sessionId}.${chunk.type}`;
    const envelope = createEnvelope(eventType, "orchestrator", chunk);
    await this.sessionManager.addEvent(sessionId, envelope);
  }

  private async buildContext(
    skill: SkillDefinition,
    triggerEvent: Envelope
  ): Promise<SkillContext> {
    let entities: Envelope["data"][] = [];

    if (triggerEvent.subject) {
      const related = await this.entityStore.traverse(triggerEvent.subject, 2);
      entities = related.map((e) => e);
    }

    const recentEvents = await this.eventBus.query(
      {
        subjects: triggerEvent.subject ? [triggerEvent.subject] : undefined,
        since: new Date(Date.now() - 3600000).toISOString(),
      },
      { limit: 20, order: "desc" }
    );

    return {
      event: triggerEvent,
      entities: entities as SkillContext["entities"],
      services: skill.tools ?? [],
      history: recentEvents,
    };
  }

  private buildMessages(
    skill: SkillDefinition,
    context: SkillContext
  ): Array<{ role: "system" | "user"; content: string }> {
    const systemPrompt = `${skill.instructions}

## Context

Event: ${JSON.stringify(context.event, null, 2)}

${context.entities.length > 0 ? `Related entities:\n${JSON.stringify(context.entities, null, 2)}` : ""}

${context.history?.length ? `Recent history:\n${JSON.stringify(context.history.slice(0, 5), null, 2)}` : ""}
`;

    return [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Process this event: ${context.event.type}` },
    ];
  }

  private async buildTools(
    skill: SkillDefinition
  ): Promise<Array<{ name: string; description: string; parameters: Record<string, unknown> }>> {
    const tools: Array<{ name: string; description: string; parameters: Record<string, unknown> }> = [];

    if (!skill.tools) return tools;

    for (const namespace of skill.tools) {
      const service = await this.serviceRegistry.get(namespace);
      if (!service) continue;

      for (const proc of service.procedures) {
        tools.push({
          name: `${namespace}.${proc.name}`,
          description: proc.description,
          parameters: proc.input.schema ?? { type: "object", properties: {} },
        });
      }
    }

    return tools;
  }

  private async executeToolCall(name: string, args: unknown): Promise<unknown> {
    const [namespace, procedure] = name.split(".");
    if (!namespace || !procedure) {
      throw new Error(`Invalid tool name: ${name}`);
    }

    return this.serviceRegistry.call(namespace, procedure, args);
  }
}
