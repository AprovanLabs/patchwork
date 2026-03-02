# Chat Integration: Unified Event System + Patchwork Chat

This document describes how the new unified event system packages integrate with Patchwork chat to create an event-driven, observable, and extensible chat experience.

---

## Overview

The integration connects five new packages to the existing chat flow:

| Package | Role in Chat |
|---------|-------------|
| `events` | Publishes chat messages, service calls, and LLM output as events |
| `graph` | Provides entity context for richer LLM prompts |
| `services` | Persistent service registry with caching and streaming |
| `skills` | Event-triggered skills that respond to chat or external events |
| `orchestrator` | Routes events to skills and manages LLM sessions |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CHAT UI                                         │
│  useChat() → POST /api/chat → streamText → MessageBubble → CodePreview      │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           EVENT BUS                                          │
│  chat.message.sent, llm.chunk, service.call.success, webhook:github.*       │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
       ┌───────────────────────────┼───────────────────────────┐
       │                           │                           │
       ▼                           ▼                           ▼
┌──────────────────┐     ┌─────────────────────┐     ┌─────────────────────┐
│  SERVICE REGISTRY │     │    ENTITY GRAPH     │     │   SKILL REGISTRY    │
│  namespace.proc() │     │  context for LLM    │     │  event triggers     │
│  caching, stream  │     │  URI-based linking  │     │  SKILL.md files     │
└───────┬──────────┘     └──────────┬──────────┘     └──────────┬──────────┘
        │                           │                           │
        └───────────────────────────┼───────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            ORCHESTRATOR                                      │
│  Event → Skill matching → LLM session → Tool calls → Result                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Integration Points

### 1. Server Initialization

Wire all components at Stitchery server startup:

```typescript
// packages/stitchery/src/server/unified.ts

import { EventStore, EventRouter, ScheduleAdapter } from '@patchwork/events';
import { EntityStore, UriPatternRegistry } from '@patchwork/graph';
import { PersistentServiceRegistry } from '@patchwork/services';
import { PersistentSkillRegistry, scanSkills } from '@patchwork/skills';
import { Orchestrator } from '@patchwork/orchestrator';
import Database from 'better-sqlite3';

export interface UnifiedContext {
  eventBus: EventRouter;
  entityStore: EntityStore;
  serviceRegistry: PersistentServiceRegistry;
  skillRegistry: PersistentSkillRegistry;
  orchestrator: Orchestrator;
}

export async function createUnifiedContext(dataDir: string): Promise<UnifiedContext> {
  const db = new Database(`${dataDir}/patchwork.db`);
  
  // Event Bus
  const eventStore = new EventStore(db);
  const eventBus = new EventRouter(eventStore, {
    maxRetries: 3,
    retryDelayMs: 1000,
    deadLetterEnabled: true,
  });
  
  // Entity Graph
  const entityStore = new EntityStore(db, { eventBus });
  
  // Service Registry
  const serviceRegistry = new PersistentServiceRegistry({
    db,
    eventBus,
    defaultCacheTtl: 300,
  });
  
  // Skill Registry
  const skillRegistry = new PersistentSkillRegistry({
    entityStore,
    eventBus,
  });
  
  // Orchestrator
  const orchestrator = new Orchestrator({
    eventBus,
    entityStore,
    serviceRegistry,
    skillRegistry,
    llmAdapter: createChatLLMAdapter(), // See section below
  });
  
  return { eventBus, entityStore, serviceRegistry, skillRegistry, orchestrator };
}
```

### 2. Publishing Chat Events

Modify `handleChat()` to publish events for observability and skill triggers:

```typescript
// packages/stitchery/src/server/routes.ts

import { createEnvelope } from '@patchwork/events';

export function createChatRoutes(ctx: RouteContext & UnifiedContext) {
  return async function handleChat(req: Request): Promise<Response> {
    const { messages } = await req.json();
    const lastMessage = messages[messages.length - 1];
    const sessionId = crypto.randomUUID();
    
    // Publish chat message event
    await ctx.eventBus.publish(createEnvelope({
      type: 'chat.message.sent',
      source: 'chat:user',
      data: {
        sessionId,
        role: lastMessage.role,
        content: lastMessage.content,
      },
      metadata: {
        chat: { sessionId },
      },
    }));
    
    // Build context from entity graph (if subject entity exists)
    const contextEntities = await buildEntityContext(ctx.entityStore, messages);
    
    const result = streamText({
      model: ctx.model,
      system: buildSystemPrompt(ctx.servicesPrompt, contextEntities),
      messages,
      tools: ctx.tools,
      onChunk: async (chunk) => {
        // Stream LLM chunks as events
        await ctx.eventBus.publish(createEnvelope({
          type: `llm.${sessionId}.chunk`,
          source: 'chat:llm',
          data: chunk,
          metadata: { chat: { sessionId } },
        }));
      },
      onFinish: async (result) => {
        await ctx.eventBus.publish(createEnvelope({
          type: `llm.${sessionId}.complete`,
          source: 'chat:llm',
          data: {
            usage: result.usage,
            finishReason: result.finishReason,
          },
          metadata: { chat: { sessionId } },
        }));
      },
    });
    
    return result.toDataStreamResponse();
  };
}
```

### 3. Entity Context for LLM Prompts

Query the entity graph to provide richer context:

```typescript
// packages/stitchery/src/server/context.ts

import { EntityStore, Entity } from '@patchwork/graph';

export async function buildEntityContext(
  entityStore: EntityStore,
  messages: Message[]
): Promise<Entity[]> {
  // Extract entity URIs from messages
  const uris = extractEntityUris(messages);
  if (uris.length === 0) return [];
  
  // Fetch entities and related context
  const entities: Entity[] = [];
  for (const uri of uris) {
    const entity = await entityStore.get(uri);
    if (entity) {
      entities.push(entity);
      // Include linked entities (1 level deep)
      const related = await entityStore.traverse(uri, 1);
      entities.push(...related.entities.filter(e => e.uri !== uri));
    }
  }
  
  return entities;
}

function extractEntityUris(messages: Message[]): string[] {
  const uriPatterns = [
    /github:[\w-]+\/[\w-]+#\d+/g,           // github:owner/repo#123
    /jira:[A-Z]+-\d+/g,                      // jira:PROJ-123
    /file:[\w\/-]+\.[\w]+/g,                 // file:/path/to/file.ts
  ];
  
  const uris = new Set<string>();
  for (const msg of messages) {
    if (typeof msg.content !== 'string') continue;
    for (const pattern of uriPatterns) {
      const matches = msg.content.match(pattern) || [];
      matches.forEach(uri => uris.add(uri));
    }
  }
  
  return [...uris];
}

function buildSystemPrompt(servicesPrompt: string, entities: Entity[]): string {
  if (entities.length === 0) return servicesPrompt;
  
  const entityContext = entities.map(e => `
### ${e.uri}
Type: ${e.type}
${JSON.stringify(e.attrs, null, 2)}
`).join('\n');
  
  return `${servicesPrompt}

## Related Entities

The following entities are referenced in the conversation:

${entityContext}
`;
}
```

### 4. Skill-Triggered Sessions

Skills can trigger LLM sessions in response to events:

```typescript
// skills/chat-responder/SKILL.md

---
id: chat-responder
name: Chat Responder
description: Responds to specific chat patterns
triggers:
  - eventFilter:
      types: ["chat.message.sent"]
    condition: "event.data.content CONTAINS '@assistant'"
model:
  provider: anthropic
  model: claude-sonnet-4-20250514
tools:
  - git
  - github
---

# Chat Responder

When the user mentions @assistant, provide a helpful response based on
the conversation context and any related entities.

## Instructions

1. Analyze the user's message for intent
2. Query the entity graph for relevant context
3. Use available tools to gather information
4. Respond with actionable guidance
```

The orchestrator automatically handles this:

```typescript
// packages/orchestrator/src/orchestrator.ts

async handleEvent(envelope: Envelope): Promise<void> {
  // Find skills that match this event
  const skills = await this.skillRegistry.findByTrigger(envelope);
  
  for (const skill of skills) {
    // Build context from entity graph
    const entities = await this.buildContext(envelope, skill);
    
    // Start LLM session
    const session = await this.startSession({
      skillId: skill.id,
      model: skill.model ?? { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
      context: {
        event: envelope,
        entities,
        services: skill.tools ?? [],
      },
    });
    
    // Execute and stream results
    await this.executeSession(session);
  }
}
```

### 5. Webhook Integration

Accept webhooks and publish to the event bus using registered inferrers:

```typescript
// packages/stitchery/src/server/webhooks.ts

import { createProviderWebhookAdapter, WebhookInferrerRegistry } from '@patchwork/events';

// Register provider-specific inferrers (typically done by loadContrib in hardcopy)
// WebhookInferrerRegistry.register(githubWebhookInferrer);
// WebhookInferrerRegistry.register(jiraWebhookInferrer);

export function createWebhookRoutes(ctx: UnifiedContext) {
  return {
    async handleWebhook(req: Request, provider: string): Promise<Response> {
      const payload = await req.json();
      const headers = Object.fromEntries(req.headers.entries());
      
      // Use registered inferrer to determine event type/subject
      const adapter = createProviderWebhookAdapter(ctx.eventBus, provider);
      await adapter(payload, headers);
      
      return new Response('OK', { status: 200 });
    },
  };
}
```

Example flow when a GitHub issue is labeled:

```
POST /webhooks/github
  ↓
WebhookInferrerRegistry.infer('github', payload, headers)
  → Envelope { type: "github.issues.labeled", subject: "github:owner/repo#123" }
  ↓
EventBus.publish()
  ↓
Orchestrator.handleEvent()
  ↓
SkillRegistry.findByTrigger() → "issue-planner" skill
  ↓
Start LLM session with context
  ↓
LLM plans tasks → Entity updates → GitHub comment
```

### 6. Schedule Integration

Run scheduled skills:

```typescript
// packages/stitchery/src/server/schedules.ts

import { ScheduleAdapter } from '@patchwork/events';

export function setupSchedules(ctx: UnifiedContext) {
  const scheduler = new ScheduleAdapter(ctx.eventBus);
  
  // Daily cleanup
  scheduler.register({
    name: 'daily-cleanup',
    cron: '0 0 * * *',
    metadata: { schedule: { purpose: 'maintenance' } },
  });
  
  // Hourly sync
  scheduler.register({
    name: 'hourly-sync',
    cron: '0 * * * *',
    metadata: { schedule: { purpose: 'sync' } },
  });
  
  scheduler.start();
  return scheduler;
}
```

---

## Example: Full Chat Session Flow

### 1. User sends message mentioning a GitHub issue

```typescript
// Chat input
"Can you help me plan the tasks for github:AprovanLabs/patchwork#42?"
```

### 2. Chat handler publishes event

```typescript
{
  id: "evt_abc123",
  timestamp: "2025-03-01T10:00:00Z",
  type: "chat.message.sent",
  source: "chat:user",
  data: {
    sessionId: "sess_xyz",
    role: "user",
    content: "Can you help me plan the tasks for github:AprovanLabs/patchwork#42?"
  },
  metadata: { chat: { sessionId: "sess_xyz" } }
}
```

### 3. Entity context is fetched

```typescript
const entities = await buildEntityContext(entityStore, messages);
// Returns:
// - github:AprovanLabs/patchwork#42 (the issue)
// - github:AprovanLabs/patchwork (the repo)
// - Any linked issues
```

### 4. LLM responds with enhanced context

```typescript
// System prompt includes:
`
## Related Entities

### github:AprovanLabs/patchwork#42
Type: github.Issue
{
  "number": 42,
  "title": "Implement unified event system",
  "state": "open",
  "labels": ["enhancement", "auto-plan"],
  "body": "..."
}

### github:AprovanLabs/patchwork
Type: github.Repository
{
  "name": "patchwork",
  "owner": "AprovanLabs",
  "default_branch": "main"
}
`
```

### 5. LLM chunks are streamed as events

```typescript
// Each chunk:
{
  type: "llm.sess_xyz.chunk",
  source: "chat:llm",
  data: { type: "text-delta", textDelta: "Based on the issue..." },
  metadata: { chat: { sessionId: "sess_xyz" } }
}
```

### 6. Skill triggers (if configured)

If a skill has a trigger for `chat.message.sent` with a condition like:

```yaml
triggers:
  - eventFilter:
      types: ["chat.message.sent"]
    condition: "event.data.content CONTAINS 'github:'"
```

The orchestrator will execute that skill alongside the main chat response.

---

## Service Call Events

When widgets call services, publish events for observability:

```typescript
// packages/stitchery/src/server/proxy.ts

export function createProxyRoutes(ctx: RouteContext & UnifiedContext) {
  return async function handleProxy(req: Request): Promise<Response> {
    const { namespace, procedure } = extractParams(req);
    const args = await req.json();
    
    const startTime = Date.now();
    
    try {
      const result = await ctx.serviceRegistry.call(namespace, procedure, args);
      
      await ctx.eventBus.publish(createEnvelope({
        type: `service.${namespace}.${procedure}.success`,
        source: `proxy:${namespace}`,
        data: { args, result, durationMs: Date.now() - startTime },
        metadata: { service: { namespace, procedure } },
      }));
      
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      await ctx.eventBus.publish(createEnvelope({
        type: `service.${namespace}.${procedure}.error`,
        source: `proxy:${namespace}`,
        data: { args, error: String(error), durationMs: Date.now() - startTime },
        metadata: { service: { namespace, procedure } },
      }));
      
      throw error;
    }
  };
}
```

---

## Streaming Services

For services that support streaming (SSE/WebSocket):

```typescript
// Widget code
const stream = await weather.subscribe_alerts({ region: 'US-CA' });
for await (const alert of stream) {
  console.log('Alert:', alert);
}

// Backend: PersistentServiceRegistry.stream()
const stream = serviceRegistry.stream('weather', 'subscribe_alerts', [{ region: 'US-CA' }]);

for await (const event of stream) {
  // Publish to event bus
  await eventBus.publish(createEnvelope({
    type: 'stream:weather.alert',
    source: 'stream:weather',
    data: event,
    metadata: { stream: { namespace: 'weather', procedure: 'subscribe_alerts' } },
  }));
  
  // Forward to client
  yield event;
}
```

---

## Observability

Query the event bus for debugging and analytics:

```typescript
// Recent chat events
const chatEvents = await eventBus.query({
  types: ['chat.*'],
  since: new Date(Date.now() - 3600000).toISOString(), // Last hour
});

// Failed service calls
const errors = await eventBus.query({
  types: ['service.*.*.error'],
  since: new Date(Date.now() - 86400000).toISOString(), // Last day
});

// LLM sessions
const sessions = await eventBus.query({
  types: ['llm.*.complete'],
  metadata: { 'skill.id': 'issue-planner' },
});

// Events for a specific entity
const issueEvents = await eventBus.query({
  subjects: ['github:AprovanLabs/patchwork#42'],
});
```

---

## Migration Path

### Phase 1: Event Observability

1. Add `EventStore` and `EventRouter` to Stitchery
2. Publish events from `handleChat()` and `handleProxy()`
3. No changes to chat UI—events are for backend observability

### Phase 2: Entity Context

1. Add `EntityStore` to Stitchery
2. Populate entities from service calls (GitHub, Jira, etc.)
3. Enhance LLM prompts with entity context

### Phase 3: Skills and Orchestrator

1. Add `PersistentSkillRegistry` and `Orchestrator`
2. Define skills that trigger on events
3. Skills run alongside normal chat flow

### Phase 4: Webhooks and Schedules

1. Add webhook routes for GitHub, Jira, etc.
2. Configure schedules for maintenance tasks
3. Skills can respond to external events

### Phase 5: Streaming and Advanced Features

1. Replace `ServiceRegistry` with `PersistentServiceRegistry`
2. Enable streaming procedures
3. Implement service caching

---

## Configuration

### Environment Variables

```bash
# Data directory for SQLite databases
PATCHWORK_DATA_DIR=/path/to/data

# Enable event system (opt-in during migration)
PATCHWORK_EVENTS_ENABLED=true

# Enable orchestrator (opt-in during migration)
PATCHWORK_ORCHESTRATOR_ENABLED=true
```

### Skills Directory

Skills are discovered from a configurable directory:

```typescript
const skillRegistry = new PersistentSkillRegistry({ entityStore, eventBus });
await skillRegistry.scanAndRegister({
  basePath: process.env.SKILLS_DIR || './skills',
  patterns: ['**/SKILL.md'],
});
```

---

## Summary

The unified event system transforms Patchwork chat from a simple request/response model to an event-driven architecture where:

1. **Everything is observable** — Chat messages, LLM output, and service calls are events
2. **Context is rich** — Entity graph provides linked data to enhance LLM prompts
3. **Skills are reactive** — Skills trigger on any event (chat, webhook, schedule)
4. **Services are persistent** — Registry supports caching, streaming, and versioning

This creates a foundation for building sophisticated automation while maintaining the simplicity of the chat interface.

---

## Implementation Files

| File | Purpose |
|------|---------|
| `packages/stitchery/src/server/unified.ts` | Context wiring, event helpers, entity context builder |
| `packages/stitchery/src/server/routes.ts` | Chat routes with event publishing and entity context |
| `packages/stitchery/src/server/index.ts` | Server with unified context, webhooks, event API |
| `skills/examples/chat-assistant/SKILL.md` | Skill triggered by @assistant mentions |
| `skills/examples/issue-planner/SKILL.md` | Skill triggered by GitHub auto-plan label |
| `skills/examples/webhook-responder/SKILL.md` | Skill triggered by PR comment webhooks |
| `skills/README.md` | Skill authoring guide |

---

## Quick Start

### 1. Enable the Event System

Pass these options when creating the server:

```typescript
import { createStitcheryServer } from '@aprovan/stitchery';

const server = await createStitcheryServer({
  port: 6434,
  copilotProxyUrl: 'http://127.0.0.1:6433/v1',
  dataDir: './data',              // Required for events
  skillsDir: './skills',          // Optional: load SKILL.md files
  enableEvents: true,             // Enable event bus
  enableOrchestrator: true,       // Enable skill triggers
  verbose: true,
});
```

### 2. New Endpoints

When `enableEvents: true`, these endpoints become available:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/webhooks/github` | POST | Receive GitHub webhooks |
| `/api/events` | POST | Query event history |

### 3. Create a Skill

```yaml
# skills/my-skill/SKILL.md
---
id: my-skill
triggers:
  - eventFilter:
      types: ["chat.message.sent"]
    condition: "data.content CONTAINS 'help'"
---

Provide helpful responses when users ask for help.
```
