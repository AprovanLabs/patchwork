import { v7 as uuidv7 } from "uuid";
import type { Envelope, EventBus } from "@patchwork/events";
import { createEnvelope } from "@patchwork/events";
import type { Session, SessionConfig, SessionStatus } from "./types.js";

export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private eventBus?: EventBus;
  private maxConcurrent: number;
  private timeoutMs: number;

  constructor(options: {
    eventBus?: EventBus;
    maxConcurrent?: number;
    timeoutMs?: number;
  } = {}) {
    this.eventBus = options.eventBus;
    this.maxConcurrent = options.maxConcurrent ?? 10;
    this.timeoutMs = options.timeoutMs ?? 300000;
  }

  async create(config: SessionConfig): Promise<Session> {
    const runningCount = Array.from(this.sessions.values()).filter(
      (s) => s.status === "running"
    ).length;

    if (runningCount >= this.maxConcurrent) {
      throw new Error(`Max concurrent sessions (${this.maxConcurrent}) reached`);
    }

    const session: Session = {
      id: uuidv7(),
      skillId: config.skillId,
      status: "pending",
      startedAt: new Date().toISOString(),
      events: [],
      parentSessionId: config.parentSessionId,
    };

    this.sessions.set(session.id, session);

    if (this.eventBus) {
      await this.eventBus.publish(
        createEnvelope("llm.session.created", "orchestrator", {
          sessionId: session.id,
          skillId: session.skillId,
          parentSessionId: session.parentSessionId,
        })
      );
    }

    return session;
  }

  async start(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    session.status = "running";

    if (this.eventBus) {
      await this.eventBus.publish(
        createEnvelope("llm.session.started", "orchestrator", {
          sessionId: session.id,
          skillId: session.skillId,
        })
      );
    }
  }

  async addEvent(sessionId: string, envelope: Envelope): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.events.push(envelope);

    if (this.eventBus) {
      await this.eventBus.publish(
        createEnvelope(`llm.${sessionId}.event`, "orchestrator", {
          sessionId,
          event: envelope,
        })
      );
    }
  }

  async complete(sessionId: string, result?: unknown): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.status = "complete";
    session.completedAt = new Date().toISOString();
    session.result = result;

    if (this.eventBus) {
      await this.eventBus.publish(
        createEnvelope("llm.session.complete", "orchestrator", {
          sessionId: session.id,
          skillId: session.skillId,
          result,
        })
      );
    }
  }

  async fail(sessionId: string, error: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.status = "failed";
    session.completedAt = new Date().toISOString();
    session.error = error;

    if (this.eventBus) {
      await this.eventBus.publish(
        createEnvelope("llm.session.failed", "orchestrator", {
          sessionId: session.id,
          skillId: session.skillId,
          error,
        })
      );
    }
  }

  async cancel(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.status = "cancelled";
    session.completedAt = new Date().toISOString();

    if (this.eventBus) {
      await this.eventBus.publish(
        createEnvelope("llm.session.cancelled", "orchestrator", {
          sessionId: session.id,
          skillId: session.skillId,
        })
      );
    }
  }

  get(sessionId: string): Session | null {
    return this.sessions.get(sessionId) ?? null;
  }

  getBySkill(skillId: string): Session[] {
    return Array.from(this.sessions.values()).filter(
      (s) => s.skillId === skillId
    );
  }

  getRunning(): Session[] {
    return Array.from(this.sessions.values()).filter(
      (s) => s.status === "running"
    );
  }

  getChildren(parentSessionId: string): Session[] {
    return Array.from(this.sessions.values()).filter(
      (s) => s.parentSessionId === parentSessionId
    );
  }

  cleanup(olderThanMs: number = 3600000): number {
    const cutoff = Date.now() - olderThanMs;
    let removed = 0;

    for (const [id, session] of this.sessions.entries()) {
      if (session.completedAt) {
        const completedAt = new Date(session.completedAt).getTime();
        if (completedAt < cutoff) {
          this.sessions.delete(id);
          removed++;
        }
      }
    }

    return removed;
  }
}
