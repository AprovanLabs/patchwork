import { serve } from "@hono/node-server";
import { createChatApp } from "./app";
import { parseEnv } from "./env";

export { createChatApp } from "./app";
export type { ChatApp } from "./app";
export { handler } from "./lambda";
export type { LambdaEvent, LambdaContext } from "hono/aws-lambda";

const env = parseEnv(process.env);

if (env.NODE_ENV !== "test") {
  const app = createChatApp();
  serve({ fetch: app.fetch, port: env.PORT }, () => {
    console.log(`Chat API listening on :${env.PORT}`);
  });
}
