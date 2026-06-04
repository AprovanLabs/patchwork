# @aprovan/mcp-app-server

MCP App Server — hosts MCP tools that compile and render interactive widgets in Claude Desktop and Claude web, optionally bridged to third-party APIs via the Aprovan Registry.

## Quick start

```bash
pnpm dev          # start with tsx watch (hot-reload)
# or
pnpm build && pnpm start
```

Server runs on `http://0.0.0.0:3000` by default.

## Registry integration (APR-61)

The server can optionally connect to the [Aprovan Registry](https://github.com/AprovanLabs/registry) MCP server to expose 30+ third-party APIs (GitHub, Slack, Stripe, Datadog, …) as callable widget services.

### Enabling the Registry backend

Set `REGISTRY_PROVIDERS` before starting the server:

```bash
REGISTRY_PROVIDERS=github,slack,stripe pnpm dev
```

The server will spawn `npx @utdk/mcp-server` automatically with the requested providers.

### Credential configuration

The server forwards all environment variables to the Registry child process, so you only need to set credentials once in the parent environment. Below are the most common providers:

| Provider | Required env vars | Notes |
|----------|-------------------|-------|
| **GitHub** | `GITHUB_TOKEN` | Personal access token or fine-grained token |
| **Stripe** | `STRIPE_SECRET_KEY` | Secret key (`sk_test_…` or `sk_live_…`) |
| **Slack** | `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` | OAuth2 client credentials; flows via client-credentials grant |
| **Notion** | `NOTION_API_KEY` | Integration token from Notion developer portal |
| **Jira** | `JIRA_EMAIL`, `JIRA_API_TOKEN` | User email + API token (basic auth) |
| **Datadog** | `DD_API_KEY`, `DD_APP_KEY` | API key + application key |
| **HubSpot** | `HUBSPOT_CLIENT_ID`, `HUBSPOT_CLIENT_SECRET` | OAuth2 client credentials |
| **Linear** | `LINEAR_API_KEY` | Personal API key |
| **Airtable** | `AIRTABLE_API_KEY` | Personal access token |
| **Zendesk** | `ZENDESK_CLIENT_ID`, `ZENDESK_CLIENT_SECRET` | OAuth2 client credentials |
| **Salesforce** | `SALESFORCE_CLIENT_ID`, `SALESFORCE_CLIENT_SECRET` | Connected app credentials |
| **SendGrid** | `SENDGRID_API_KEY` | API key |
| **Twilio** | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | Account SID + auth token |
| **Intercom** | `INTERCOM_ACCESS_TOKEN` | Access token from Intercom developer hub |
| **Figma** | `FIGMA_ACCESS_TOKEN` | Personal access token |
| **OpenAI** | `OPENAI_API_KEY` | API key |
| **Discord** | `DISCORD_BOT_TOKEN` | Bot token |

For providers not listed here, inspect the provider package at `packages/utdk/<provider>/package.json` in the registry repo and look at the `utdk.auth` field.

### Local development example

Create a `.env` file (never commit this):

```bash
# .env — loaded by dotenv or direnv
REGISTRY_PROVIDERS=github,stripe

GITHUB_TOKEN=ghp_...
STRIPE_SECRET_KEY=sk_test_...
```

Then start:

```bash
# with dotenv-cli
dotenv pnpm dev

# or export manually
export $(grep -v '^#' .env | xargs) && pnpm dev
```

### Using Registry tools in a widget

Once the Registry is connected, any tool namespace (e.g. `github`, `stripe`) can be requested in the `compile_widget` `services` parameter:

```
Tool: compile_widget
{
  "source": "...",
  "services": ["github", "stripe"]
}
```

Inside the widget, services are available as global namespace objects:

```typescript
// List repositories
const repos = await github.repos_list({ per_page: 10 });

// Create a payment intent
const intent = await stripe.payment_intents_create({
  amount: 2000,
  currency: "usd",
});
```

The call chain is: widget → `callServerTool` → `ServiceBridge` → `RegistryBackend` → `@utdk/mcp-server` → provider API.

### Overriding the Registry command

By default the server uses `npx @utdk/mcp-server`. You can point to a locally built binary instead:

```bash
REGISTRY_COMMAND=/path/to/registry/apps/mcp-server/dist/server.js \
REGISTRY_PROVIDERS=github \
GITHUB_TOKEN=ghp_... \
node dist/server.js
```

### Namespace collision avoidance

Registry tool namespaces (one per provider) are registered separately from any locally-defined service tools. To check which namespaces are active, call `search_services` with no arguments from a Claude conversation using the connected MCP server.

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP port to listen on |
| `HOST` | `0.0.0.0` | Host interface |
| `REGISTRY_PROVIDERS` | _(unset)_ | Enable Registry backend; comma-separated provider list |
| `REGISTRY_COMMAND` | `npx` | Command used to spawn the Registry MCP server |
| `REGISTRY_ARGS` | _(unset)_ | Space-separated extra args appended after `@utdk/mcp-server` |

## MCP endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/mcp` | MCP Streamable HTTP endpoint |
| `GET` | `/health` | Health check |
