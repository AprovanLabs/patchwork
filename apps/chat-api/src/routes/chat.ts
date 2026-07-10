import { withTracing } from "@posthog/ai";
import {
  streamText,
  convertToModelMessages,
  wrapLanguageModel,
  stepCountIs,
  jsonSchema,
  type LanguageModelMiddleware,
  type UIMessage,
  type Tool,
} from "ai";
import { Hono } from "hono";
import { z } from "zod";
import { CHAT_PROMPT_ALLOWLIST } from "../fallback-prompts.js";
import {
  evictGatewaySession,
  getGatewaySession,
  getCachedTools,
  setCachedTools,
} from "../gateway-session.js";
import { getPrompt, compilePrompt, getPostHogClient } from "../posthog.js";
import {
  getOpenRouterKey,
  createOpenRouterProvider,
} from "../providers/openrouter.js";
import { getToolDocs, makeHttpGatewayClient } from "../tool-docs.js";
import type { AppVariables } from "../types.js";

const chatBodySchema = z.object({
  id: z.string(),
  messages: z.array(z.any()),
  trigger: z.string(),
  metadata: z.unknown().optional(),
  prompt: z
    .object({
      id: z.string(),
      vars: z
        .object({
          compilers: z.array(z.string()).optional(),
        })
        .optional(),
    })
    .optional(),
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

interface GatewayToolEntry {
  provider: string;
  name: string;
  operation: string;
  description?: string;
  inputSchema?: unknown;
}

async function fetchGatewayTools(
  gatewayUrl: string,
  bearerToken: string,
): Promise<GatewayToolEntry[]> {
  const res = await fetch(`${gatewayUrl}/tools`, {
    headers: { Authorization: `Bearer ${bearerToken}` },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { tools: GatewayToolEntry[] };
  return data.tools ?? [];
}

function buildTools(
  gatewayTools: GatewayToolEntry[],
  gatewayUrl: string,
  bearerToken: string,
): Record<string, Tool> {
  const tools: Record<string, Tool> = {};

  for (const t of gatewayTools) {
    // Replace dots with underscores — some models reject dots in function names.
    const toolKey = t.name.replace(/\./g, "_");

    const rawSchema =
      t.inputSchema && typeof t.inputSchema === "object"
        ? t.inputSchema
        : { type: "object", properties: {} };

    const parameters = jsonSchema<Record<string, unknown>>(
      rawSchema as Parameters<typeof jsonSchema>[0],
    );

    const execute = async (args: Record<string, unknown>): Promise<unknown> => {
      const res = await fetch(`${gatewayUrl}/tools/${t.provider}/${t.operation}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${bearerToken}`,
        },
        body: JSON.stringify(args),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        return { error: (err as { error?: string }).error ?? res.statusText };
      }
      return res.json();
    };

    tools[toolKey] = {
      description: t.description ?? `Call ${t.name}`,
      parameters,
      execute,
    } as unknown as Tool;
  }

  return tools;
}

chatRoute.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = chatBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request body" }, 400);
  }

  const { messages, prompt: promptBody } = parsed.data;
  const claims = c.get("claims");
  const workspaceId = c.get("workspaceId");
  const workspace = c.get("workspace");

  const promptId = promptBody?.id ?? "chat-patchwork-widget";
  if (!CHAT_PROMPT_ALLOWLIST.has(promptId)) {
    return c.json({ error: "Unknown prompt id" }, 400);
  }

  // Gateway tools are additive — chat works without them.
  const gatewayUrl = process.env["GATEWAY_URL"]?.replace(/\/$/, "");
  let sessionToken: string | null = null;

  if (gatewayUrl) {
    const authHeader = c.req.header("Authorization") ?? "";
    const cognitoToken = authHeader.replace(/^Bearer /, "");
    try {
      const session = await getGatewaySession(claims, workspaceId, cognitoToken);
      sessionToken = session.token;
    } catch {
      // Non-fatal — continue without gateway tools
    }
  }

  let gatewayTools: GatewayToolEntry[] = [];
  if (sessionToken && gatewayUrl) {
    const cached = getCachedTools(claims.sub) as GatewayToolEntry[] | undefined;
    if (cached) {
      gatewayTools = cached;
    } else {
      gatewayTools = await fetchGatewayTools(gatewayUrl, sessionToken).catch(
        () => [] as GatewayToolEntry[],
      );
      if (gatewayTools.length === 0) {
        evictGatewaySession(claims.sub);
      } else {
        setCachedTools(claims.sub, gatewayTools);
      }
    }
  }

  const tools =
    sessionToken && gatewayUrl
      ? buildTools(gatewayTools, gatewayUrl, sessionToken)
      : {};

  // Load system prompt from PostHog (cached, with fallback to bundled copy)
  const gatewayClient = gatewayUrl ? makeHttpGatewayClient(gatewayUrl) : null;
  const [promptResult, toolDocs] = await Promise.all([
    getPrompt(promptId),
    getToolDocs(gatewayClient).catch(() => ""),
  ]);
  const compilers = (promptBody?.vars?.compilers ?? []).join(", ");
  const systemPrompt = compilePrompt(promptResult.prompt, {
    compilers,
    tool_docs: toolDocs,
  });

  const apiKey = await getOpenRouterKey();
  const provider = createOpenRouterProvider(apiKey);
  const modelId = workspace.limits.maxModels[0] ?? "openrouter/auto";
  const baseModel = provider(modelId);

  const phClient = getPostHogClient();
  const tracedModel =
    phClient && promptResult.source !== "code_fallback"
      ? withTracing(baseModel, phClient, {
          posthogDistinctId: claims.sub,
          posthogProperties: {
            $ai_prompt_name: promptResult.name,
            $ai_prompt_version: promptResult.version,
          },
        })
      : baseModel;

  const model = wrapLanguageModel({
    model: tracedModel,
    middleware: retryAtStartMiddleware,
  });

  const result = streamText({
    model,
    system: systemPrompt,
    messages: await convertToModelMessages(messages as UIMessage[]),
    stopWhen: stepCountIs(workspace.limits.maxToolSteps),
    maxOutputTokens: workspace.limits.maxTokensPerRequest,
    tools,
  });

  return result.toUIMessageStreamResponse();
});
