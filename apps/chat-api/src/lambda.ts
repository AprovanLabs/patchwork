import { streamHandle } from "hono/aws-lambda";
import { createChatApp, initPostHog } from "./app.js";
import { parseEnv } from "./env.js";
import type { LambdaEvent } from "hono/aws-lambda";

const env = parseEnv(process.env);

// Initialize module-scope PostHog singletons once per cold start
initPostHog(env);

const app = createChatApp();

export const handler = streamHandle(app) as (
  event: LambdaEvent,
  context: unknown,
  callback: unknown,
) => Promise<unknown>;
