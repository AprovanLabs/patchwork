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
import type { IncomingMessage, ServerResponse } from 'node:http';

export interface RouteContext {
  providerUrl: string;
  providerApiKey?: string;
  tools: Record<string, Tool>;
  registry: ServiceRegistry;
  servicesPrompt: string;
  log: (...args: unknown[]) => void;
}

// OpenRouter
// nvidia/nemotron-3-super-120b-a12b:free
// nvidia/nemotron-3-ultra-550b-a55b:free
// openai/gpt-oss-20b:free

// Cerebras
// gpt-oss-120b

// Synthetic
// nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-NVFP4

const Models = {
  Low: 'nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-NVFP4',
  High: 'nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-NVFP4',
};

export function stripUnsupportedOpenAICompatibleFields(
  args: Record<string, unknown>,
): Record<string, unknown> {
  const body = { ...args };

  if (Array.isArray(body.messages)) {
    body.messages = body.messages.map((message) => {
      if (
        message &&
        typeof message === 'object' &&
        'role' in message &&
        (message as Record<string, unknown>).role === 'assistant' &&
        'reasoning_content' in (message as Record<string, unknown>)
      ) {
        const { reasoning_content, ...rest } = message as Record<string, unknown>;
        return rest;
      }
      return message;
    });
  }

  return body;
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

  const normalizedMessages = messages.map((msg) => ({
    ...msg,
    parts: msg.parts ?? [{ type: 'text' as const, text: '' }],
  }));

  const provider = createOpenAICompatible({
    name: 'provider',
    baseURL: ctx.providerUrl,
    apiKey: ctx.providerApiKey,
    ...(
      ctx.providerUrl.includes('cerebras') && {
        transformRequestBody: stripUnsupportedOpenAICompatibleFields,
      }
    )
  });

  const result = streamText({
    model: provider(Models.Low),
    system: `---\npatchwork:\n  compilers: ${
      (metadata?.patchwork?.compilers ?? []).join(',') ?? '[]'
    }\n  services: ${ctx.registry
      .getNamespaces()
      .join(',')}\n---\n\n${PATCHWORK_PROMPT}\n\n${ctx.servicesPrompt}`,
    messages: await convertToModelMessages(normalizedMessages),
    stopWhen: stepCountIs(5),
    tools: ctx.tools,
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
    name: 'provider',
    baseURL: ctx.providerUrl,
    apiKey: ctx.providerApiKey
  });

  const result = streamText({
    model: provider(Models.Low),
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
