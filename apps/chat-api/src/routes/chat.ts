import {
  streamText,
  convertToModelMessages,
  wrapLanguageModel,
  stepCountIs,
  type LanguageModelMiddleware,
  type UIMessage,
} from "ai";
import { Hono } from "hono";
import { z } from "zod";
import {
  getOpenRouterKey,
  createOpenRouterProvider,
} from "../providers/openrouter.js";
import type { AppVariables } from "../types.js";

const chatBodySchema = z.object({
  id: z.string(),
  messages: z.array(z.any()),
  trigger: z.string(),
  metadata: z.unknown().optional(),
});

// Retry once (200 ms backoff) if the provider rejects before the first
// streamed byte. Once doStream() resolves (headers received, 2xx), the
// connection is committed and mid-stream errors surface as error UI parts.
const retryAtStartMiddleware: LanguageModelMiddleware = {
  specificationVersion: "v3",
  async wrapStream({ doStream }) {
    try {
      return await doStream();
    } catch {
      await new Promise<void>((r) => setTimeout(r, 200));
      return doStream();
    }
  },
};

export const chatRoute = new Hono<{ Variables: AppVariables }>();

chatRoute.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = chatBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request body" }, 400);
  }

  const { messages } = parsed.data;
  const workspace = c.get("workspace");

  const apiKey = await getOpenRouterKey();
  const provider = createOpenRouterProvider(apiKey);
  const modelId = workspace.limits.maxModels[0] ?? "openrouter/auto";

  const model = wrapLanguageModel({
    model: provider(modelId),
    middleware: retryAtStartMiddleware,
  });

  const result = streamText({
    model,
    messages: await convertToModelMessages(messages as UIMessage[]),
    stopWhen: stepCountIs(workspace.limits.maxToolSteps),
    maxOutputTokens: workspace.limits.maxTokensPerRequest,
    // tools: {} — stub; real gateway wiring in APR-298
  });

  return result.toUIMessageStreamResponse();
});
