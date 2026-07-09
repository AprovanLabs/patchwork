import { withTracing } from "@posthog/ai";
import { streamText } from "ai";
import { Hono } from "hono";
import { z } from "zod";
import { EDIT_PROMPT_ID } from "../fallback-prompts.js";
import { getPrompt, compilePrompt, getPostHogClient } from "../posthog.js";
import {
  getOpenRouterKey,
  createOpenRouterProvider,
} from "../providers/openrouter.js";
import type { AppVariables } from "../types.js";

const editBodySchema = z.object({
  code: z.string(),
  prompt: z.string(),
});

const MODEL_ID = "openrouter/auto";

export const editRoute = new Hono<{ Variables: AppVariables }>();

editRoute.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = editBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request body" }, 400);
  }

  const promptResult = await getPrompt(EDIT_PROMPT_ID);
  const systemPrompt = compilePrompt(promptResult.prompt, {
    code: parsed.data.code,
  });

  const apiKey = await getOpenRouterKey();
  const provider = createOpenRouterProvider(apiKey);
  const baseModel = provider(MODEL_ID);

  const phClient = getPostHogClient();
  const model =
    phClient && promptResult.source !== "code_fallback"
      ? withTracing(baseModel, phClient, {
          posthogDistinctId: "chat-api",
          posthogProperties: {
            $ai_prompt_name: promptResult.name,
            $ai_prompt_version: promptResult.version,
          },
        })
      : baseModel;

  const result = streamText({
    model,
    system: systemPrompt,
    messages: [{ role: "user", content: parsed.data.prompt }],
  });

  return result.toTextStreamResponse();
});
