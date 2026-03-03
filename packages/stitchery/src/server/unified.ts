/**
 * Unified Context - Wires event bus, entity graph, services, skills, and orchestrator
 *
 * Integrates @patchwork/events, @patchwork/graph, @patchwork/skills, and @patchwork/orchestrator
 * with the existing Stitchery server for event-driven chat.
 */

import type {
  EventBus,
  Envelope,
  EventFilter,
  QueryOptions,
} from "@patchwork/events";
import type { EntityGraph, Entity } from "@patchwork/graph";
import type { SkillRegistry, SkillDefinition } from "@patchwork/skills";
import type { Orchestrator } from "@patchwork/orchestrator";

export interface UnifiedContext {
  eventBus: EventBus;
  entityStore: EntityGraph;
  skillRegistry: SkillRegistry;
  orchestrator: Orchestrator;
}

export interface UnifiedContextConfig {
  dataDir: string;
  skillsDir?: string;
  enableOrchestrator?: boolean;
}

export async function createUnifiedContext(
  config: UnifiedContextConfig
): Promise<UnifiedContext> {
  const { EventStore } = await import("@patchwork/events");
  const { EntityStore } = await import("@patchwork/graph");
  const { PersistentSkillRegistry, scanSkills } = await import(
    "@patchwork/skills"
  );
  const { Orchestrator: OrchestratorImpl } = await import(
    "@patchwork/orchestrator"
  );

  const dbPath = `${config.dataDir}/patchwork.db`;

  const eventBus = new EventStore({ dbPath });

  const entityStore = new EntityStore({
    dbPath,
    eventBus,
    autoExtractLinks: true,
  });

  const skillRegistry = new PersistentSkillRegistry({
    entityStore,
    eventBus,
  });

  if (config.skillsDir) {
    const skills = await scanSkills({ basePath: config.skillsDir });
    for (const skill of skills) {
      await skillRegistry.register(skill);
    }
  }

  const orchestrator = new OrchestratorImpl({
    eventBus,
    entityStore,
    skillRegistry,
  });

  if (config.enableOrchestrator) {
    orchestrator.start();
  }

  return { eventBus, entityStore, skillRegistry, orchestrator };
}

export { createEnvelope } from "@patchwork/events";

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
  const { createEnvelope } = await import("@patchwork/events");
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
  const { createEnvelope } = await import("@patchwork/events");
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
  const { createEnvelope } = await import("@patchwork/events");
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
  const { createEnvelope } = await import("@patchwork/events");
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
