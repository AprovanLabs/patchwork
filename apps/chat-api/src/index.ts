import { serve } from "@hono/node-server";
import { createChatApp, initPostHog } from "./app.js";
import { parseEnv } from "./env.js";

export { createChatApp, initPostHog } from "./app.js";
export type { ChatApp } from "./app.js";

const env = parseEnv(process.env);

initPostHog(env);

if (env.NODE_ENV !== "test") {
  const app = createChatApp(env);
  serve({ fetch: app.fetch, port: env.PORT }, () => {
    console.log(`Chat API listening on :${env.PORT}`);
  });
}
