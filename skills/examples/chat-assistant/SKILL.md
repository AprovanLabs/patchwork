---
id: chat-assistant
name: Chat Assistant
description: Responds to chat messages that mention @assistant
triggers:
  - eventFilter:
      types: ["chat.message.sent"]
    condition: "data.content CONTAINS '@assistant'"
    priority: 10
model:
  provider: anthropic
  model: claude-sonnet-4-20250514
tools:
  - git
  - github
---

# Chat Assistant

This skill triggers when users mention `@assistant` in their chat messages. It provides contextual help based on the conversation and any referenced entities.

## Behavior

When triggered, the assistant will:

1. Analyze the user's message for intent
2. Query the entity graph for related context (issues, files, etc.)
3. Use available tools to gather information
4. Provide a helpful, actionable response

## Example Triggers

```
User: "@assistant can you help me understand github:owner/repo#42?"
→ Skill activates, fetches issue details, provides summary

User: "What's the status of this PR? @assistant"
→ Skill activates, checks for PR context, reports status
```

## Context

The skill receives:
- The triggering event (chat message)
- Related entities from the graph
- Available services (git, github)
