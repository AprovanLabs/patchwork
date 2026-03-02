# Skills

Skills are event-triggered LLM sessions that respond to chat messages, webhooks, schedules, and other events.

## Structure

```
skills/
├── examples/
│   ├── chat-assistant/       # Responds to @assistant mentions
│   │   └── SKILL.md
│   ├── issue-planner/        # Plans tasks from GitHub issues
│   │   └── SKILL.md
│   └── webhook-responder/    # Responds to PR comments
│       └── SKILL.md
└── README.md
```

## Skill File Format

Each skill is defined by a `SKILL.md` file with YAML frontmatter:

```yaml
---
id: my-skill                    # Unique identifier
name: My Skill                  # Display name
description: What it does       # Brief description
triggers:                       # When to activate
  - eventFilter:
      types: ["event.type.*"]   # Event type patterns
    condition: "data.field = 'value'"  # Optional condition
    priority: 5                 # Higher = runs first
model:                          # LLM configuration
  provider: anthropic
  model: claude-sonnet-4-20250514
tools:                          # Required services
  - git
  - github
---

# Skill Title

Markdown instructions for the LLM...
```

## Event Types

| Source | Event Types |
|--------|-------------|
| Chat | `chat.message.sent`, `chat.message.received` |
| LLM | `llm.{session}.chunk`, `llm.{session}.complete` |
| Service | `service.{ns}.{proc}.success`, `service.{ns}.{proc}.error` |
| Webhook | `webhook:github.*`, `webhook:jira.*` |
| Schedule | `schedule.triggered` |
| Manual | `manual.*` |

## Conditions

Conditions are expressions evaluated against the event envelope:

```yaml
# Simple field match
condition: "data.label.name = 'auto-plan'"

# Contains check
condition: "data.content CONTAINS '@assistant'"

# Metadata match
condition: "metadata.skill.id = 'issue-planner'"
```

## Execution Flow

```
Event Published
      ↓
SkillRegistry.findByTrigger(event)
      ↓
For each matching skill:
  ↓
  Orchestrator.buildContext()
    - Fetch subject entity
    - Traverse related entities
    - Get event history
  ↓
  Orchestrator.startSession()
    - Configure model
    - Load skill instructions
    - Bind tools from services
  ↓
  LLM executes with context
    - Streams chunks as events
    - Tool calls go through ServiceRegistry
    - Results stored in EntityStore
```

## Creating a Skill

1. Create a directory: `skills/my-skill/`
2. Add `SKILL.md` with frontmatter and instructions
3. Register with: `skillRegistry.scanAndRegister({ basePath: 'skills' })`

## Testing Skills

Manually trigger a skill:

```typescript
await eventBus.publish({
  id: 'test-event',
  timestamp: new Date().toISOString(),
  type: 'chat.message.sent',
  source: 'test:manual',
  data: {
    content: '@assistant help me with this issue',
    sessionId: 'test-session',
  },
  metadata: {},
});
```

Watch for skill execution:

```typescript
eventBus.subscribe(
  { types: ['llm.*.complete'] },
  async (event) => console.log('Skill completed:', event)
);
```
