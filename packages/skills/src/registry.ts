import type { EventBus, Envelope, EntityGraph } from "@aprovan/apprentice";
import { createEnvelope } from "@aprovan/apprentice";
import type {
  SkillDefinition,
  SkillRegistry,
  SkillSummary,
  SkillTrigger,
} from "./types.js";
import { scanSkills, loadSkillContent, type ScanOptions } from "./scanner.js";

export interface SkillRegistryOptions {
  eventBus?: EventBus;
  entityGraph?: EntityGraph;
}

export class PersistentSkillRegistry implements SkillRegistry {
  private skills: Map<string, SkillDefinition> = new Map();
  private eventBus?: EventBus;
  private entityGraph?: EntityGraph;

  constructor(options: SkillRegistryOptions = {}) {
    this.eventBus = options.eventBus;
    this.entityGraph = options.entityGraph;
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

    if (this.entityGraph) {
      await this.entityGraph.upsert({
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

    if (this.entityGraph) {
      await this.entityGraph.delete(skill.uri);
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
