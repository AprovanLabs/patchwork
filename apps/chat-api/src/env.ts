import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.coerce.number().default(3001),

  // LLM provider
  PROVIDER_URL: z.string().default("https://openrouter.ai/api/v1"),
  PROVIDER_API_KEY: z.string().optional(),

  // Registry gateway (for tool_docs cache)
  GATEWAY_URL: z.string().optional(),

  // PostHog prompt management
  POSTHOG_PROJECT_API_KEY: z.string().optional(),
  POSTHOG_PERSONAL_API_KEY: z.string().optional(),
  POSTHOG_HOST: z.string().default("https://us.posthog.com"),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(raw: Record<string, string | undefined>): Env {
  return envSchema.parse(raw);
}
