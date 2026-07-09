import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { zValidator } from "@hono/zod-validator";
import { withTracing } from "@posthog/ai";
import {
  streamText,
  convertToModelMessages,
  stepCountIs,
  type UIMessage,
} from "ai";
import { Hono } from "hono";
import { z } from "zod";
import { CHAT_PROMPT_ALLOWLIST } from "../fallback-prompts.js";
import { getPrompt, compilePrompt, getPostHogClient } from "../posthog.js";
import { getToolDocs } from "../tool-docs.js";
import type { GatewayClient } from "../tool-docs.js";

const chatBodySchema = z.object({
  messages: z.array(z.any()),
  prompt: z
    .object({
      id: z.string(),
      version: z.number().optional(),
      vars: z
        .object({
          compilers: z.array(z.string()).optional(),
        })
        .optional(),
    })
    .optional(),
});

const MODEL_ID = "nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-NVFP4";

function stripUnsupportedFields(
  args: Record<string, unknown>,
): Record<string, unknown> {
  const body = { ...args };
  if (Array.isArray(body.messages)) {
    body.messages = body.messages.map((message) => {
      if (
        message &&
        typeof message === "object" &&
        "role" in message &&
        (message as Record<string, unknown>).role === "assistant" &&
        "reasoning_content" in (message as Record<string, unknown>)
      ) {
        const { reasoning_content: _, ...rest } = message as Record<
          string,
          unknown
        >;
        return rest;
      }
      return message;
    });
  }
  return body;
}

export function createChatRoute(
  providerUrl: string,
  providerApiKey: string | undefined,
  gateway: GatewayClient | null,
): Hono {
  const chat = new Hono();

  chat.post(
    "/api/chat",
    zValidator("json", chatBodySchema, (result, c) => {
      if (!result.success) return c.json({ error: "Invalid request" }, 400);
      return undefined;
    }),
    async (c) => {
      const body = c.req.valid("json");

      const promptId = body.prompt?.id ?? "chat-patchwork-widget";
      if (!CHAT_PROMPT_ALLOWLIST.has(promptId)) {
        return c.json({ error: `Unknown prompt: ${promptId}` }, 400);
      }

      const [promptResult, toolDocs] = await Promise.all([
        getPrompt(promptId),
        getToolDocs(gateway),
      ]);

      const compilers = (body.prompt?.vars?.compilers ?? []).join(", ");
      const systemPrompt = compilePrompt(promptResult.prompt, {
        compilers,
        tool_docs: toolDocs,
      });

      const provider = createOpenAICompatible({
        name: "provider",
        baseURL: providerUrl,
        apiKey: providerApiKey,
        ...(providerUrl.includes("cerebras") && {
          transformRequestBody: stripUnsupportedFields,
        }),
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

      const messages = (body.messages as UIMessage[]).map((msg) => ({
        ...msg,
        parts: msg.parts ?? [{ type: "text" as const, text: "" }],
      }));

      const result = streamText({
        model,
        system: systemPrompt,
        messages: await convertToModelMessages(messages),
        stopWhen: stepCountIs(5),
      });

      return result.toUIMessageStreamResponse();
    },
  );

  return chat;
}
