/**
 * Unified Context - Wires event bus, entity graph, services, skills, and orchestrator
 *
 * Integrates @aprovan/apprentice with @patchwork/skills for event-driven chat.
 */

import type {
  EventBus,
  Envelope,
  EntityGraph,
  Entity,
  Orchestrator,
  SkillResolver,
  ToolExecutor,
} from "@aprovan/apprentice";
import type { ServiceRegistry } from "@patchwork/services";
import type { SkillRegistry, SkillDefinition } from "@patchwork/skills";

export interface UnifiedContext {
  eventBus: EventBus;
  entityStore: EntityGraph;
  skillRegistry: SkillRegistry;
  serviceRegistry: ServiceRegistry;
  orchestrator: Orchestrator;
  close(): void;
}

export interface UnifiedContextConfig {
  dataDir: string;
  skillsDir?: string;
  enableOrchestrator?: boolean;
}

interface ConfigurableOrchestrator extends Orchestrator {
  setSkillResolver(resolver: SkillResolver): void;
  setToolExecutor(executor: ToolExecutor): void;
}

export async function createUnifiedContext(
  config: UnifiedContextConfig
): Promise<UnifiedContext> {
  const { createApprentice } = await import("@aprovan/apprentice");
  const { PersistentSkillRegistry, scanSkills } = await import(
    "@patchwork/skills"
  );
  const { PersistentServiceRegistry } = await import("@patchwork/services");

  const dbPath = `${config.dataDir}/patchwork.db`;

  const apprentice = createApprentice({ dbPath });

  const serviceRegistry = new PersistentServiceRegistry({
    dbPath: `${config.dataDir}/services.db`,
    eventBus: apprentice.eventBus,
  });

  const skillRegistry = new PersistentSkillRegistry({
    entityGraph: apprentice.entityGraph,
    eventBus: apprentice.eventBus,
  });

  if (config.skillsDir) {
    const skills = await scanSkills({ basePath: config.skillsDir });
    for (const skill of skills) {
      await skillRegistry.register(skill);
    }
  }

  const skillResolver: SkillResolver = {
    async resolve(envelope: Envelope): Promise<string | null> {
      const skills = await skillRegistry.findByTrigger(envelope);
      const first = skills[0];
      return first?.id ?? null;
    },
  };

  const orch = apprentice.orchestrator as ConfigurableOrchestrator;
  orch.setSkillResolver(skillResolver);

  const toolExecutor: ToolExecutor = {
    async execute(
      name: string,
      args: Record<string, unknown>,
      _context: { sessionId: string }
    ): Promise<unknown> {
      const [namespace, procedure] = name.split(".");
      if (!namespace || !procedure) {
        throw new Error(`Invalid tool name: ${name}`);
      }
      return serviceRegistry.call(namespace, procedure, args);
    },
  };
  orch.setToolExecutor(toolExecutor);

  return {
    eventBus: apprentice.eventBus,
    entityStore: apprentice.entityGraph,
    skillRegistry,
    serviceRegistry,
    orchestrator: apprentice.orchestrator,
    close() {
      serviceRegistry.close();
      apprentice.close();
    },
  };
}

export { createEnvelope } from "@aprovan/apprentice";

const URI_PATTERNS = [
  /github:[\w-]+\/[\w-]+#\d+/g,
  /jira:[A-Z]+-\d+/g,
  /file:[\w\/-]+\.\w+/g,
  /skill:[\w\/-]+\/SKILL\.md/g,
];

export function extractEntityUris(content: string): string[] {
  const uris = new Set<string>();
  for (const pattern of URI_PATTERNS) {
    pattern.lastIndex = 0;
    const matches = content.match(pattern) || [];
    matches.forEach((uri) => uris.add(uri));
  }
  return [...uris];
}

export async function buildEntityContext(
  entityStore: EntityGraph,
  messages: Array<{ role: string; content: string | unknown }>
): Promise<Entity[]> {
  const allContent = messages
    .map((m) => (typeof m.content === "string" ? m.content : ""))
    .join("\n");

  const uris = extractEntityUris(allContent);
  if (uris.length === 0) return [];

  const entities: Entity[] = [];
  const seen = new Set<string>();

  for (const uri of uris) {
    if (seen.has(uri)) continue;
    seen.add(uri);

    const entity = await entityStore.get(uri);
    if (entity) {
      entities.push(entity);
      const related = await entityStore.traverse(uri, 1);
      for (const rel of related) {
        if (!seen.has(rel.uri)) {
          seen.add(rel.uri);
          entities.push(rel);
        }
      }
    }
  }

  return entities;
}

export function formatEntityContext(entities: Entity[]): string {
  if (entities.length === 0) return "";

  const sections = entities
    .map(
      (e) => `
### ${e.uri}
Type: ${e.type}
${JSON.stringify(e.attrs, null, 2)}
`
    )
    .join("\n");

  return `
## Related Entities

The following entities are referenced in the conversation:

${sections}
`;
}

export async function publishChatEvent(
  eventBus: EventBus,
  sessionId: string,
  role: string,
  content: string
): Promise<void> {
  const { createEnvelope } = await import("@aprovan/apprentice");
  await eventBus.publish(
    createEnvelope("chat.message.sent", `chat:${role}`, {
      sessionId,
      role,
      content,
    })
  );
}

export async function publishLLMComplete(
  eventBus: EventBus,
  sessionId: string,
  result: { usage?: unknown; finishReason?: string }
): Promise<void> {
  const { createEnvelope } = await import("@aprovan/apprentice");
  await eventBus.publish(
    createEnvelope(`llm.${sessionId}.complete`, "chat:llm", result, {
      metadata: { chat: { sessionId } },
    })
  );
}

export async function publishServiceCall(
  eventBus: EventBus,
  namespace: string,
  procedure: string,
  args: unknown,
  result: unknown,
  durationMs: number,
  error?: string
): Promise<void> {
  const { createEnvelope } = await import("@aprovan/apprentice");
  const type = error
    ? `service.${namespace}.${procedure}.error`
    : `service.${namespace}.${procedure}.success`;

  await eventBus.publish(
    createEnvelope(
      type,
      `proxy:${namespace}`,
      error ? { args, error, durationMs } : { args, result, durationMs },
      { metadata: { service: { namespace, procedure } } }
    )
  );
}

export function extractGitHubSubject(
  payload: Record<string, unknown>
): string | undefined {
  const repo = payload.repository as { full_name?: string } | undefined;
  const issue = payload.issue as { number?: number } | undefined;
  const pr = payload.pull_request as { number?: number } | undefined;

  if (!repo?.full_name) return undefined;

  const number = issue?.number ?? pr?.number;
  if (number) {
    return `github:${repo.full_name}#${number}`;
  }

  return `github:${repo.full_name}`;
}

export async function publishGitHubWebhook(
  eventBus: EventBus,
  event: string,
  payload: Record<string, unknown>,
  delivery?: string
): Promise<void> {
  const { createEnvelope } = await import("@aprovan/apprentice");
  const action = (payload.action as string) ?? "unknown";

  await eventBus.publish(
    createEnvelope(
      `webhook:github.${event}.${action}`,
      "webhook:github",
      payload,
      {
        subject: extractGitHubSubject(payload),
        metadata: {
          github: { event, action, delivery },
        },
      }
    )
  );
}
