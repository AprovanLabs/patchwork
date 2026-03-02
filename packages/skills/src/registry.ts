import type { EventBus, Envelope } from "@patchwork/events";
import { createEnvelope } from "@patchwork/events";
import type { EntityStore } from "@patchwork/graph";
import type {
  SkillDefinition,
  SkillRegistry,
  SkillSummary,
  SkillContext,
  SkillResult,
  SkillTrigger,
} from "./types.js";
import { scanSkills, loadSkillContent, type ScanOptions } from "./scanner.js";

export interface SkillRegistryOptions {
  eventBus?: EventBus;
  entityStore?: EntityStore;
  executor?: SkillExecutor;
}

export interface SkillExecutor {
  execute(skill: SkillDefinition, context: SkillContext): Promise<SkillResult>;
}

export class PersistentSkillRegistry implements SkillRegistry {
  private skills: Map<string, SkillDefinition> = new Map();
  private eventBus?: EventBus;
  private entityStore?: EntityStore;
  private executor?: SkillExecutor;

  constructor(options: SkillRegistryOptions = {}) {
    this.eventBus = options.eventBus;
    this.entityStore = options.entityStore;
    this.executor = options.executor;
  }

  async scanAndRegister(options: ScanOptions): Promise<number> {
    const skills = await scanSkills(options);
    for (const skill of skills) {
      await this.register(skill);
    }
    return skills.length;
  }

  async register(skill: SkillDefinition): Promise<void> {
    this.skills.set(skill.id, skill);

    if (this.entityStore) {
      await this.entityStore.upsert({
        uri: skill.uri,
        type: "skill.Definition",
        attrs: {
          name: skill.name,
          description: skill.description,
          triggers: skill.triggers,
          tools: skill.tools,
          model: skill.model,
        },
        version: skill.version,
      });
    }

    if (this.eventBus) {
      await this.eventBus.publish(
        createEnvelope("skill.registered", "skill-registry", {
          id: skill.id,
          name: skill.name,
          uri: skill.uri,
        })
      );
    }
  }

  async unregister(skillId: string): Promise<void> {
    const skill = this.skills.get(skillId);
    if (!skill) return;

    this.skills.delete(skillId);

    if (this.entityStore) {
      await this.entityStore.delete(skill.uri);
    }

    if (this.eventBus) {
      await this.eventBus.publish(
        createEnvelope("skill.unregistered", "skill-registry", { id: skillId })
      );
    }
  }

  async get(skillId: string): Promise<SkillDefinition | null> {
    return this.skills.get(skillId) ?? null;
  }

  async list(): Promise<SkillSummary[]> {
    return Array.from(this.skills.values()).map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      triggerCount: skill.triggers?.length ?? 0,
      toolCount: skill.tools?.length ?? 0,
    }));
  }

  async search(query: string): Promise<SkillDefinition[]> {
    const queryLower = query.toLowerCase();
    return Array.from(this.skills.values()).filter((skill) => {
      const searchText = `${skill.name} ${skill.description} ${skill.instructions}`.toLowerCase();
      return searchText.includes(queryLower);
    });
  }

  async findByTrigger(event: Envelope): Promise<SkillDefinition[]> {
    const matching: Array<{ skill: SkillDefinition; priority: number }> = [];

    for (const skill of this.skills.values()) {
      if (!skill.triggers) continue;

      for (const trigger of skill.triggers) {
        if (this.matchesTrigger(event, trigger)) {
          matching.push({
            skill,
            priority: trigger.priority ?? 0,
          });
          break;
        }
      }
    }

    return matching
      .sort((a, b) => b.priority - a.priority)
      .map((m) => m.skill);
  }

  async execute(skillId: string, context: SkillContext): Promise<SkillResult> {
    const skill = await this.get(skillId);
    if (!skill) {
      return {
        skillId,
        success: false,
        error: `Skill not found: ${skillId}`,
        duration: 0,
        events: [],
      };
    }

    if (!this.executor) {
      return {
        skillId,
        success: false,
        error: "No executor configured",
        duration: 0,
        events: [],
      };
    }

    const startTime = Date.now();

    if (this.eventBus) {
      await this.eventBus.publish(
        createEnvelope("skill.execution.started", "skill-registry", {
          skillId,
          eventId: context.event.id,
        })
      );
    }

    try {
      const result = await this.executor.execute(skill, context);
      
      if (this.eventBus) {
        await this.eventBus.publish(
          createEnvelope(
            result.success ? "skill.execution.completed" : "skill.execution.failed",
            "skill-registry",
            {
              skillId,
              success: result.success,
              duration: result.duration,
              error: result.error,
            }
          )
        );
      }

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (this.eventBus) {
        await this.eventBus.publish(
          createEnvelope("skill.execution.failed", "skill-registry", {
            skillId,
            error: errorMessage,
            duration,
          })
        );
      }

      return {
        skillId,
        success: false,
        error: errorMessage,
        duration,
        events: [],
      };
    }
  }

  private matchesTrigger(event: Envelope, trigger: SkillTrigger): boolean {
    const filter = trigger.eventFilter;

    if (filter.types?.length) {
      const matches = filter.types.some((pattern) =>
        this.matchPattern(event.type, pattern)
      );
      if (!matches) return false;
    }

    if (filter.sources?.length) {
      const matches = filter.sources.some((pattern) =>
        this.matchPattern(event.source, pattern)
      );
      if (!matches) return false;
    }

    if (filter.subjects?.length) {
      if (!event.subject) return false;
      const matches = filter.subjects.some((pattern) =>
        this.matchPattern(event.subject!, pattern)
      );
      if (!matches) return false;
    }

    if (trigger.condition) {
      if (!this.evaluateCondition(trigger.condition, event)) {
        return false;
      }
    }

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

  private evaluateCondition(condition: string, event: Envelope): boolean {
    try {
      const fn = new Function("event", `return ${condition}`);
      return Boolean(fn(event));
    } catch {
      return false;
    }
  }
}
