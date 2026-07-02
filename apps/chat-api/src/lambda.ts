import { streamHandle } from "hono/aws-lambda";
import type { LambdaEvent } from "hono/aws-lambda";
import { createChatApp } from "./app";

const app = createChatApp();

export const handler = streamHandle(app) as (
  event: LambdaEvent,
  context: unknown,
  callback: unknown,
) => Promise<unknown>;
