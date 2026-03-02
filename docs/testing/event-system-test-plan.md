# Event System Test Plan

This document outlines how to test the unified event system integration with Patchwork chat.

---

## Prerequisites

1. Build all packages:
   ```bash
   cd /Users/jsampson/Documents/JacobSampson/patchwork
   pnpm install
   pnpm build
   ```

2. Ensure copilot-proxy is available

---

## Test 1: Basic Event Publishing (Chat Messages)

**Goal:** Verify that chat messages are published as events.

### Steps

1. Start the dev server:
   ```bash
   cd apps/chat
   pnpm dev
   ```

2. Open the chat UI in browser (typically http://127.0.0.1:3700)

3. Send a test message:
   ```
   Hello, this is a test message
   ```

4. Query the events API to verify:
   ```bash
   curl -X POST http://127.0.0.1:3701/api/events \
     -H "Content-Type: application/json" \
     -d '{"types": ["chat.message.sent"], "limit": 10}'
   ```

### Expected Result

- Response contains event with:
  - `type: "chat.message.sent"`
  - `source: "chat:user"`
  - `data.content` matching your message

---

## Test 2: Service Call Events

**Goal:** Verify that widget service calls are published as events.

### Steps

1. With the server running, ask the chat to create a widget that calls a service:
   ```
   Create a widget that shows the weather forecast for Seattle
   ```

2. After the widget renders and calls the weather API, query events:
   ```bash
   curl -X POST http://127.0.0.1:3701/api/events \
     -H "Content-Type: application/json" \
     -d '{"types": ["service.*"], "limit": 10}'
   ```

### Expected Result

- Response contains events like:
  - `type: "service.weather.{procedure}.success"`
  - `data.durationMs` showing call duration
  - `data.args` and `data.result`

---

## Test 3: Entity Context (GitHub References)

**Goal:** Verify that entity URIs in messages are extracted and used.

### Steps

1. First, populate an entity in the graph (this would normally come from webhooks):
   ```bash
   # For now, we can test URI extraction without the entity existing
   ```

2. Send a message with an entity reference:
   ```
   Can you help me understand github:AprovanLabs/patchwork#42?
   ```

3. Check server logs (verbose mode) to see if entity context was attempted

### Expected Result

- Server logs show entity URI extraction: `github:AprovanLabs/patchwork#42`
- If entity exists in graph, it's included in LLM context

---

## Test 4: LLM Completion Events

**Goal:** Verify that LLM session completions are published.

### Steps

1. Send any message to the chat

2. Query for LLM completion events:
   ```bash
   curl -X POST http://127.0.0.1:3701/api/events \
     -H "Content-Type: application/json" \
     -d '{"types": ["llm.*.complete"], "limit": 10}'
   ```

### Expected Result

- Response contains events with:
  - `type: "llm.{sessionId}.complete"`
  - `data.usage` with token counts
  - `data.finishReason`

---

## Test 5: GitHub Webhook Integration

**Goal:** Verify that GitHub webhooks are received and published.

### Steps

1. Use ngrok or similar to expose local server:
   ```bash
   ngrok http 3701
   ```

2. Configure a GitHub webhook to point to `{ngrok-url}/webhooks/github`

3. Trigger a webhook (e.g., create/label an issue)

4. Query webhook events:
   ```bash
   curl -X POST http://127.0.0.1:3701/api/events \
     -H "Content-Type: application/json" \
     -d '{"types": ["webhook:github.*"], "limit": 10}'
   ```

### Alternative: Manual Webhook Test

```bash
curl -X POST http://127.0.0.1:3701/webhooks/github \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: issues" \
  -H "X-GitHub-Delivery: test-123" \
  -d '{
    "action": "labeled",
    "issue": {"number": 42, "title": "Test Issue"},
    "label": {"name": "auto-plan"},
    "repository": {"full_name": "AprovanLabs/patchwork"}
  }'
```

### Expected Result

- Response: `OK`
- Event stored with:
  - `type: "webhook:github.issues.labeled"`
  - `subject: "github:AprovanLabs/patchwork#42"`

---

## Test 6: Event History Query

**Goal:** Verify event query filtering works.

### Steps

1. After running previous tests, query with various filters:

   ```bash
   # All events in last hour
   curl -X POST http://127.0.0.1:3701/api/events \
     -H "Content-Type: application/json" \
     -d '{"since": "2025-03-01T11:00:00Z", "limit": 50}'

   # Events for specific subject
   curl -X POST http://127.0.0.1:3701/api/events \
     -H "Content-Type: application/json" \
     -d '{"subjects": ["github:AprovanLabs/patchwork#42"]}'

   # Service errors only
   curl -X POST http://127.0.0.1:3701/api/events \
     -H "Content-Type: application/json" \
     -d '{"types": ["service.*.*.error"]}'
   ```

### Expected Result

- Filtered results matching the query criteria

---

## Test 7: Skill Loading (Optional)

**Goal:** Verify skills are loaded from disk.

### Steps

1. Check server startup logs for skill loading:
   ```
   [stitchery] Skills loaded from: /path/to/skills
   ```

2. Skills should be registered but won't trigger without orchestrator enabled

### To Enable Orchestrator

Update `start-dev.ts` to add `--enable-orchestrator` flag, then skills will:
- Subscribe to event bus
- Trigger on matching events
- Start LLM sessions automatically

---

## Debugging Tips

### Check Server Logs

The server runs with `-v` (verbose) flag by default in dev mode. Look for:
- `[stitchery] Unified context initialized`
- `[stitchery] Event system: enabled`
- `[stitchery] GitHub webhook: {event}`

### Inspect SQLite Database

```bash
sqlite3 apps/chat/data/patchwork.db

# View recent events
SELECT id, type, timestamp FROM events ORDER BY timestamp DESC LIMIT 20;

# View entities
SELECT uri, type FROM entities;
```

### Check Event Bus Health

```bash
curl http://127.0.0.1:3701/health
# Should return: {"status":"ok","service":"stitchery"}
```

---

## Summary

| Test | What it Verifies |
|------|------------------|
| Test 1 | Chat messages become events |
| Test 2 | Service calls are tracked |
| Test 3 | Entity URIs are extracted |
| Test 4 | LLM sessions are logged |
| Test 5 | Webhooks are received |
| Test 6 | Event queries work |
| Test 7 | Skills are loaded |

After all tests pass, the event system is operational and ready for:
- Building analytics dashboards
- Creating event-triggered skills
- Debugging chat sessions
- Monitoring service health
