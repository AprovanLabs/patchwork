import type { IncomingMessage, ServerResponse } from 'node:http';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import {
  streamText,
  convertToModelMessages,
  stepCountIs,
  type UIMessage,
  type Tool,
} from 'ai';
import { PATCHWORK_PROMPT, EDIT_PROMPT } from '../prompts.js';
import type { ServiceRegistry } from './services.js';
import type { UnifiedContext } from './unified.js';
import {
  buildEntityContext,
  formatEntityContext,
  publishChatEvent,
  publishLLMComplete,
} from './unified.js';

export interface RouteContext {
  copilotProxyUrl: string;
  tools: Record<string, Tool>;
  registry: ServiceRegistry;
  servicesPrompt: string;
  log: (...args: unknown[]) => void;
  unified?: UnifiedContext;
}

function parseBody<T>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

export async function handleChat(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
): Promise<void> {
  const {
    messages,
    metadata,
  }: {
    messages: UIMessage[];
    metadata?: { patchwork?: { compilers?: string[] } };
  } = await parseBody(req);

  const sessionId = crypto.randomUUID();
  const lastMessage = messages[messages.length - 1];

  const normalizedMessages = messages.map((msg) => ({
    ...msg,
    parts: msg.parts ?? [{ type: 'text' as const, text: '' }],
  }));

  const lastContent =
    lastMessage?.parts?.find((p) => p.type === 'text')?.text ?? '';

  if (ctx.unified && lastContent) {
    await publishChatEvent(
      ctx.unified.eventBus,
      sessionId,
      lastMessage?.role ?? 'user',
      lastContent
    );
  }

  let entityContext = '';
  if (ctx.unified) {
    try {
      const entities = await buildEntityContext(
        ctx.unified.entityStore,
        normalizedMessages.map((m) => ({
          role: m.role,
          content: m.parts?.find((p) => p.type === 'text')?.text ?? '',
        }))
      );
      entityContext = formatEntityContext(entities);
    } catch (err) {
      ctx.log('Entity context error:', err);
    }
  }

  const provider = createOpenAICompatible({
    name: 'copilot-proxy',
    baseURL: ctx.copilotProxyUrl,
  });

  const systemPrompt = `---
patchwork:
  compilers: ${(metadata?.patchwork?.compilers ?? []).join(',') ?? '[]'}
  services: ${ctx.registry.getNamespaces().join(',')}
---

${PATCHWORK_PROMPT}

${ctx.servicesPrompt}
${entityContext}`;

  const result = streamText({
    model: provider('claude-sonnet-4'),
    system: systemPrompt,
    messages: await convertToModelMessages(normalizedMessages),
    stopWhen: stepCountIs(5),
    tools: ctx.tools,
    onFinish: async ({ usage, finishReason }) => {
      if (ctx.unified) {
        await publishLLMComplete(ctx.unified.eventBus, sessionId, {
          usage,
          finishReason,
        });
      }
    },
  });

  const response = result.toUIMessageStreamResponse();
  response.headers.forEach((value: string, key: string) =>
    res.setHeader(key, value),
  );

  if (!response.body) {
    res.end();
    return;
  }

  const reader = response.body.getReader();
  const pump = async () => {
    const { done, value } = await reader.read();
    if (done) {
      res.end();
      return;
    }
    res.write(value);
    await pump();
  };
  await pump();
}

export async function handleEdit(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
): Promise<void> {
  const { code, prompt }: { code: string; prompt: string } = await parseBody(
    req,
  );

  const provider = createOpenAICompatible({
    name: 'copilot-proxy',
    baseURL: ctx.copilotProxyUrl,
  });

  const result = streamText({
    model: provider('claude-opus-4.5'),
    system: `Current component code:\n\`\`\`tsx\n${code}\n\`\`\`\n\n${EDIT_PROMPT}`,
    messages: [{ role: 'user', content: prompt }],
  });

  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.writeHead(200);

  for await (const chunk of result.textStream) {
    res.write(chunk);
  }
  res.end();
}
