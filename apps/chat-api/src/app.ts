import { Hono } from "hono";
import { initPostHog } from "./posthog.js";
import { createChatRoute } from "./routes/chat.js";
import { createEditRoute } from "./routes/edit.js";
import { health } from "./routes/health.js";
import { makeHttpGatewayClient, type GatewayClient } from "./tool-docs.js";
import type { Env } from "./env.js";

export function createChatApp(env?: Partial<Env>) {
  const providerUrl = env?.PROVIDER_URL ?? "https://openrouter.ai/api/v1";
  const providerApiKey = env?.PROVIDER_API_KEY;

  const gateway: GatewayClient | null = env?.GATEWAY_URL
    ? makeHttpGatewayClient(env.GATEWAY_URL)
    : null;

  const app = new Hono();
  app.route("/", health);
  app.route("/", createChatRoute(providerUrl, providerApiKey, gateway));
  app.route("/", createEditRoute(providerUrl, providerApiKey));

  return app;
}

export type ChatApp = ReturnType<typeof createChatApp>;

export { initPostHog };
