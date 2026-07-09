import { Prompts, type PromptResult } from "@posthog/ai";
import { PostHog } from "posthog-node";
import { FALLBACK_PROMPTS } from "./fallback-prompts.js";
import type { Env } from "./env.js";

// Module-scope singletons — survive Lambda warm invocations
let _client: PostHog | null = null;
let _prompts: Prompts | null = null;

export function initPostHog(env: Env): void {
  if (!env.POSTHOG_PROJECT_API_KEY || !env.POSTHOG_PERSONAL_API_KEY) return;

  _client = new PostHog(env.POSTHOG_PROJECT_API_KEY, {
    host: env.POSTHOG_HOST,
    personalApiKey: env.POSTHOG_PERSONAL_API_KEY,
  });

  _prompts = new Prompts({ posthog: _client });
}

export async function getPrompt(
  name: string,
  cacheTtlSeconds = 300,
): Promise<PromptResult> {
  const fallback = FALLBACK_PROMPTS[name] ?? "";

  if (!_prompts) {
    return { source: "code_fallback", prompt: fallback, name: undefined, version: undefined };
  }

  return _prompts.get(name, { cacheTtlSeconds, fallback });
}

export function compilePrompt(
  template: string,
  vars: Record<string, string>,
): string {
  if (_prompts) {
    return _prompts.compile(template, vars);
  }
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}

export function getPostHogClient(): PostHog | null {
  return _client;
}

export type { PostHog };
