import type {
  Orchestrator,
  OrchestratorConfig,
  EventBus,
  EntityGraph,
  SessionManager,
  Envelope,
  SkillResolver,
  ToolExecutor,
  ExternalNotifier,
} from "./types.js";
import { createEnvelope } from "./event-bus.js";

interface QueuedTask {
  sessionId: string;
  envelope: Envelope;
}

export interface OrchestratorOptions {
  eventBus: EventBus;
  entityGraph: EntityGraph;
  sessionManager: SessionManager;
  config?: OrchestratorConfig;
  notifier?: ExternalNotifier;
}

export class OrchestratorImpl implements Orchestrator {
  private eventBus: EventBus;
  private entityGraph: EntityGraph;
  private sessionManager: SessionManager;
  private skillResolver?: SkillResolver;
  private toolExecutor?: ToolExecutor;
  private notifier?: ExternalNotifier;
  private maxConcurrent: number;
  private activeTasks: Map<string, boolean> = new Map();
  private queue: QueuedTask[] = [];

  constructor(options: OrchestratorOptions) {
    this.eventBus = options.eventBus;
    this.entityGraph = options.entityGraph;
    this.sessionManager = options.sessionManager;
    this.skillResolver = options.config?.skillResolver;
    this.toolExecutor = options.config?.toolExecutor;
    this.notifier = options.notifier;
    this.maxConcurrent = options.config?.maxConcurrent ?? 5;
  }

  setSkillResolver(resolver: SkillResolver): void {
    this.skillResolver = resolver;
  }

  setToolExecutor(executor: ToolExecutor): void {
    this.toolExecutor = executor;
  }

  setNotifier(notifier: ExternalNotifier): void {
    this.notifier = notifier;
  }

  async start(sessionId: string, envelope: Envelope): Promise<void> {
    const session = await this.sessionManager.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (session.status !== "active") {
      throw new Error(`Session ${sessionId} is not active`);
    }

    if (this.activeTasks.size >= this.maxConcurrent) {
      this.queue.push({ sessionId, envelope });
      await this.eventBus.publish(createEnvelope(
        "orchestrator.task.queued",
        "orchestrator",
        { sessionId, eventId: envelope.id },
        { subject: sessionId }
      ));
      return;
    }

    await this.executeTask(sessionId, envelope);
  }

  async pause(sessionId: string): Promise<void> {
    await this.sessionManager.update(sessionId, { status: "paused" });
    await this.eventBus.publish(createEnvelope(
      "orchestrator.session.paused",
      "orchestrator",
      { sessionId },
      { subject: sessionId }
    ));
  }

  async resume(sessionId: string): Promise<void> {
    await this.sessionManager.update(sessionId, { status: "active" });
    await this.eventBus.publish(createEnvelope(
      "orchestrator.session.resumed",
      "orchestrator",
      { sessionId },
      { subject: sessionId }
    ));

    this.processQueue();
  }

  async cancel(sessionId: string): Promise<void> {
    this.activeTasks.delete(sessionId);
    this.queue = this.queue.filter((t) => t.sessionId !== sessionId);
    await this.sessionManager.update(sessionId, { status: "failed" });
    await this.eventBus.publish(createEnvelope(
      "orchestrator.session.cancelled",
      "orchestrator",
      { sessionId },
      { subject: sessionId }
    ));
  }

  async executeTool(
    sessionId: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    if (!this.toolExecutor) {
      throw new Error("No tool executor configured");
    }

    await this.eventBus.publish(createEnvelope(
      "orchestrator.tool.started",
      "orchestrator",
      { sessionId, toolName, args },
      { subject: sessionId }
    ));

    try {
      const result = await this.toolExecutor.execute(toolName, args, { sessionId });

      await this.eventBus.publish(createEnvelope(
        "orchestrator.tool.completed",
        "orchestrator",
        { sessionId, toolName, result },
        { subject: sessionId }
      ));

      return result;
    } catch (error) {
      await this.eventBus.publish(createEnvelope(
        "orchestrator.tool.failed",
        "orchestrator",
        { sessionId, toolName, error: String(error) },
        { subject: sessionId }
      ));
      throw error;
    }
  }

  private async executeTask(sessionId: string, envelope: Envelope): Promise<void> {
    this.activeTasks.set(sessionId, true);

    await this.eventBus.publish(createEnvelope(
      "orchestrator.task.started",
      "orchestrator",
      { sessionId, eventId: envelope.id },
      { subject: sessionId }
    ));

    try {
      let skillId: string | null = null;
      if (this.skillResolver) {
        skillId = await this.skillResolver.resolve(envelope);
      }

      if (skillId) {
        await this.eventBus.publish(createEnvelope(
          "orchestrator.skill.matched",
          "orchestrator",
          { sessionId, skillId, eventType: envelope.type },
          { subject: sessionId }
        ));
      }

      await this.eventBus.publish(createEnvelope(
        "orchestrator.task.completed",
        "orchestrator",
        { sessionId, eventId: envelope.id, skillId },
        { subject: sessionId }
      ));

      if (this.notifier) {
        await this.notifier.notify(createEnvelope(
          "task.completed",
          "orchestrator",
          { sessionId, eventId: envelope.id }
        ));
      }
    } catch (error) {
      await this.eventBus.publish(createEnvelope(
        "orchestrator.task.failed",
        "orchestrator",
        { sessionId, eventId: envelope.id, error: String(error) },
        { subject: sessionId }
      ));

      if (this.notifier) {
        await this.notifier.notify(createEnvelope(
          "task.failed",
          "orchestrator",
          { sessionId, error: String(error) }
        ));
      }
    } finally {
      this.activeTasks.delete(sessionId);
      this.processQueue();
    }
  }

  private processQueue(): void {
    while (this.queue.length > 0 && this.activeTasks.size < this.maxConcurrent) {
      const task = this.queue.shift();
      if (task) {
        this.executeTask(task.sessionId, task.envelope);
      }
    }
  }
}
