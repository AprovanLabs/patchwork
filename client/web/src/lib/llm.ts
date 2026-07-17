/**
 * Gateway LLM chat provider API (`/llm/*` routes).
 *
 * Chat providers are gateway-side aliases onto OpenAI-compatible UTDK
 * modules; this module is the client surface for listing them (with
 * connected state) and enumerating their models.
 */

import { GATEWAY_BASE } from "./gateway";
import { gatewayFetch } from "./gateway-fetch";

export interface LlmProviderInfo {
  id: string;
  label: string;
  defaultModel: string;
  connected: boolean;
}

export async function fetchLlmProviders(): Promise<LlmProviderInfo[] | null> {
  if (!GATEWAY_BASE) return null;
  try {
    const response = await gatewayFetch(`${GATEWAY_BASE}/llm/providers`);
    if (!response.ok) return null;
    const body = (await response.json()) as { providers?: LlmProviderInfo[] };
    return Array.isArray(body.providers) ? body.providers : null;
  } catch {
    return null;
  }
}

export async function fetchLlmModels(providerId: string): Promise<string[]> {
  const response = await gatewayFetch(
    `${GATEWAY_BASE}/llm/${encodeURIComponent(providerId)}/models`,
  );
  if (!response.ok) throw new Error(`model listing failed (${response.status})`);
  const body = (await response.json()) as { models?: string[] };
  return Array.isArray(body.models) ? body.models : [];
}

/** Per-provider chat model preference ("" = provider default). */
const MODEL_KEY_PREFIX = "patchwork:chat-model:";

export function loadModelPreference(providerId: string): string {
  return localStorage.getItem(`${MODEL_KEY_PREFIX}${providerId}`) ?? "";
}

export function saveModelPreference(providerId: string, model: string): void {
  if (model) localStorage.setItem(`${MODEL_KEY_PREFIX}${providerId}`, model);
  else localStorage.removeItem(`${MODEL_KEY_PREFIX}${providerId}`);
}
