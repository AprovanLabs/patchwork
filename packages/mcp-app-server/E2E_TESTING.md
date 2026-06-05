# E2E Widget Testing Guide

This guide covers how to set up and test Patchwork widgets across Claude Desktop, Claude web, and Claude mobile.

## Prerequisites

- Node.js >= 20
- pnpm
- `cloudflared` CLI (for web/mobile testing)
- Provider API keys (optional, for service proxy calls)

## 1. Start the MCP App Server

```bash
cd packages/mcp-app-server
pnpm build && pnpm start
```

The server listens on `http://0.0.0.0:3000` by default. Override with the `PORT` environment variable.

### With Registry services

Set `REGISTRY_PROVIDERS` and any required credentials before starting:

```bash
REGISTRY_PROVIDERS=github,stripe \
GITHUB_TOKEN=ghp_... \
STRIPE_SECRET_KEY=sk_test_... \
pnpm start
```

This spawns the Aprovan Registry MCP server as a child process, making its tools available to widgets via the `ServiceBridge`.

## 2. Claude Desktop (Local MCP Connection)

Claude Desktop connects to the MCP App Server via a local MCP server configuration.

### Setup

1. Install the MCP App Server globally or use npx:
   ```bash
   # Option A: Install globally
   cd packages/mcp-app-server
   pnpm build
   npm link
   
   # Option B: Use npx (after publishing to npm)
   # npx @aprovan/mcp-app-server
   ```

2. Open Claude Desktop settings → Developer → Edit Config
3. Add the MCP server entry to `claude_desktop_config.json`:

   **For local development (HTTP transport):**
   ```json
   {
     "mcpServers": {
       "patchwork": {
         "url": "http://localhost:3000/mcp"
       }
     }
   }
   ```

   **For stdio transport (after npm link):**
   ```json
   {
     "mcpServers": {
       "patchwork": {
         "command": "mcp-app-server",
         "env": {
           "PORT": "3000"
         }
       }
     }
   }
   ```

4. Restart Claude Desktop

### Testing procedure

1. Start a new conversation
2. Ask Claude: "Use the compile_widget tool to create a live dashboard widget"
3. Provide widget source code or ask Claude to generate it
4. Verify the widget renders inline in the conversation
5. Test service calls by asking: "Call weather.get_forecast for San Francisco"
6. Test live updates by asking: "Push a price update to the price_feed stream"
7. Verify the widget updates in real time

### What to verify

- Widget renders as an interactive MCP App resource
- `compile_widget` returns a resource URI and the widget displays inline
- `list_widgets` shows persisted widgets
- `render_widget` re-renders a stored widget
- Service tool calls (e.g., `weather__get_forecast`) return data
- `push_update` → `notifications/tools/list_changed` → widget polls `poll_updates`
- `search_services` discovers available service tools

## 3. Claude Web (via cloudflared tunnel)

Claude web uses a remote MCP server, accessible through a cloudflared tunnel.

### Setup

1. Start the MCP App Server locally
2. Expose it via cloudflared:

```bash
cloudflared tunnel --url http://localhost:3000
```

3. Copy the generated `https://xxx.trycloudflare.com` URL
4. In Claude web, add a custom MCP connector with the URL:

```
https://xxx.trycloudflare.com/mcp
```

### Testing procedure

Same as Claude Desktop, but accessed through the browser-based Claude interface.

### Additional verifications for web

- CORS headers are present (the server enables `cors()` middleware)
- SSE stream works through the tunnel (stateful sessions)
- MCP session ID is preserved across requests
- Widget renders correctly in the browser iframe sandbox

## 4. Claude Mobile (via custom connector)

Claude mobile also uses a custom MCP connector, similar to web.

### Setup

1. Follow the same cloudflared steps as web
2. In the Claude mobile app, add a custom connector with the tunnel URL
3. The mobile MCP client connects to the same `POST /mcp` endpoint

### Testing procedure

Same as Desktop and Web.

### Additional verifications for mobile

- Touch interactions work in the rendered widget
- Widget viewport scales correctly on mobile screens
- Live update notifications are delivered on mobile connections
- Session persistence across app foreground/background transitions

## 5. Reference Widget: Live Dashboard

A reference widget (`live-dashboard`) is included in `src/reference-widgets/live-dashboard.ts`. It exercises the full stack:

- **Multi-file project**: `main.tsx`, `price-card.tsx`, `status-panel.tsx`, `action-bar.tsx`
- **Service calls**: Uses `weather` namespace via the service proxy shim
- **Live updates**: Subscribes to `price_feed` and `system_status` streams
- **Context feedback**: Sends widget state back to the model via `patchwork.updateContext()`
- **User interaction**: Buttons trigger `patchwork.fireEvent()` and `patchwork.updateContext()`

### Compiling the reference widget

In a Claude conversation with the MCP server connected:

```
Use compile_widget with:
- files: (paste the four file contents from src/reference-widgets/live-dashboard.ts)
- services: ["weather"]
- name: "live-dashboard"
```

Or ask Claude: "Compile the live dashboard reference widget with weather services."

## 6. Automated E2E Tests

Automated integration tests cover the server-side pipeline:

```bash
cd packages/mcp-app-server
pnpm test
```

The `e2e-pipeline.test.ts` file covers:

- Compile → VFS store → retrieve round-trip
- Service shim injection in compiled HTML
- Live update shim injection in compiled HTML
- CDN preload scripts and Tailwind CSS
- Cache hit/miss behavior
- ServiceBridge tool registration and call forwarding
- Live update channel: push, poll, subscribe, notify
- Multi-session broadcasting
- Combined service + live-update shim coherence
- Widget store CRUD with compiled output
- MCP server tool registration with service bridge

## 7. Troubleshooting

### Widget doesn't render

- Check the MCP server is running: `GET /health` should return `{"status":"ok"}`
- Check the compile_widget output for error messages
- Verify the widget source exports a default React component

### Service calls fail

- Ensure `REGISTRY_PROVIDERS` is set and the provider API keys are in the environment
- Check server logs for `[mcp-app-server]` messages about missing services
- Verify the service namespace exists by calling `search_services`

### Live updates don't arrive

- Ensure the MCP session is stateful (not stateless)
- Check that `subscribe_stream` was called with the correct session ID
- Verify `notifications/tools/list_changed` is being sent (check server logs)
- Confirm the widget's `poll_updates` handler is correctly wired

### Cloudflared tunnel drops connections

- Restart the tunnel if it disconnects
- Check that the MCP App Server is still running on the local port
- Verify the health endpoint responds through the tunnel
