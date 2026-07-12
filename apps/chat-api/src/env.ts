import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.coerce.number().default(3001),
  COGNITO_USER_POOL_ID: z.string().min(1),
  COGNITO_CLIENT_ID: z.string().min(1),
  AWS_REGION: z.string().default("us-east-1"),
  WORKSPACE_TABLE_NAME: z.string().min(1),
  MEMBERSHIPS_TABLE_NAME: z.string().min(1),
  USERS_TABLE_NAME: z.string().min(1),
  OPENROUTER_SECRET_ARN: z.string().min(1),
  GATEWAY_URL: z.string().url(),

  // VFS backing store (optional — routes degrade gracefully when unset)
  VFS_TABLE_NAME: z.string().optional(),
  VFS_BUCKET_NAME: z.string().optional(),

  // PostHog prompt management (optional — falls back to code prompts when absent)
  POSTHOG_PROJECT_API_KEY: z.string().optional(),
  POSTHOG_PERSONAL_API_KEY: z.string().optional(),
  POSTHOG_HOST: z.string().default("https://us.posthog.com"),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(raw: Record<string, string | undefined>): Env {
  return envSchema.parse(raw);
}
