import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

let secretsClient: SecretsManagerClient | null = null;
let cachedKey: string | null = null;

function getSecretsClient(): SecretsManagerClient {
  if (!secretsClient) {
    secretsClient = new SecretsManagerClient({
      region: process.env["AWS_REGION"],
    });
  }
  return secretsClient;
}

export async function getOpenRouterKey(): Promise<string> {
  if (cachedKey) return cachedKey;

  const result = await getSecretsClient().send(
    new GetSecretValueCommand({
      SecretId: process.env["OPENROUTER_SECRET_ARN"]!,
    }),
  );
  cachedKey = result.SecretString!;
  return cachedKey!;
}

export function createOpenRouterProvider(apiKey: string) {
  return createOpenAICompatible({
    name: "openrouter",
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
  });
}
