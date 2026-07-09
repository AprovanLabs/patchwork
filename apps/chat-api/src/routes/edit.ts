import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { zValidator } from "@hono/zod-validator";
import { withTracing } from "@posthog/ai";
import { streamText } from "ai";
import { Hono } from "hono";
import { z } from "zod";
import { EDIT_PROMPT_ID } from "../fallback-prompts.js";
import { getPrompt, compilePrompt, getPostHogClient } from "../posthog.js";

const editBodySchema = z.object({
  code: z.string(),
  prompt: z.string(),
});

const MODEL_ID = "nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-NVFP4";

export function createEditRoute(
  providerUrl: string,
  providerApiKey: string | undefined,
): Hono {
  const edit = new Hono();

  edit.post(
    "/api/edit",
    zValidator("json", editBodySchema, (result, c) => {
      if (!result.success) return c.json({ error: "Invalid request" }, 400);
      return undefined;
    }),
    async (c) => {
      const body = c.req.valid("json");

      const promptResult = await getPrompt(EDIT_PROMPT_ID);
      const systemPrompt = compilePrompt(promptResult.prompt, {
        code: body.code,
      });

      const provider = createOpenAICompatible({
        name: "provider",
        baseURL: providerUrl,
        apiKey: providerApiKey,
      });

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
        messages: [{ role: "user", content: body.prompt }],
      });

      return result.toTextStreamResponse();
    },
  );

  return edit;
}
