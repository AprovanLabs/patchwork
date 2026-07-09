#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { ChatStack } from "../src/stacks/chat-stack";

const app = new cdk.App();

// ── Environment helpers ────────────────────────────────────────────────────
function requireContext(key: string): string {
  const v = app.node.tryGetContext(key) as string | undefined;
  if (!v) throw new Error(`CDK context value '${key}' is required. Pass with -c ${key}=<value>`);
  return v;
}

function optionalContext(key: string): string | undefined {
  return app.node.tryGetContext(key) as string | undefined;
}

// ── Resolve deploy environment ─────────────────────────────────────────────
const deployEnv = (process.env["DEPLOY_ENV"] ?? "dev") as "dev" | "prod";

const awsEnv: cdk.Environment = {
  account: process.env["CDK_DEFAULT_ACCOUNT"],
  region: process.env["CDK_DEFAULT_REGION"] ?? "us-east-1",
};

// ── Chat stack (one per environment) ──────────────────────────────────────
new ChatStack(app, `AprovanChat-${deployEnv}`, {
  env: awsEnv as Required<cdk.Environment>,
  stackName: `aprovan-chat-${deployEnv}`,
  description: `Patchwork chat backend — ${deployEnv}`,
  tags: {
    Project: "patchwork",
    Env: deployEnv,
    ManagedBy: "cdk",
  },

  // DynamoDB tables — pass ARNs so the CDK need not know the full table object
  workspaceTableName: requireContext("workspaceTableName"),
  workspaceTableArn: requireContext("workspaceTableArn"),
  membershipsTableName: requireContext("membershipsTableName"),
  membershipsTableArn: requireContext("membershipsTableArn"),

  // Cognito
  cognitoUserPoolId: requireContext("cognitoUserPoolId"),
  cognitoClientId: requireContext("cognitoClientId"),

  // Secrets
  openRouterSecretArn: requireContext("openRouterSecretArn"),

  // Gateway
  gatewayBaseUrl: requireContext("gatewayBaseUrl"),

  // Domain / TLS — certificate must be in us-east-1 (CloudFront requirement)
  domainName: requireContext("domainName"),
  certificateArn: requireContext("certificateArn"),

  // CORS — comma-separated list in context, split here
  corsOrigins: requireContext("corsOrigins").split(",").map((o) => o.trim()),

  // Optional PostHog observability
  posthogProjectApiKey: optionalContext("posthogProjectApiKey"),
  posthogPersonalApiKey: optionalContext("posthogPersonalApiKey"),
});

app.synth();
