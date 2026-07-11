import * as path from "path";
import { Construct } from "constructs";
import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as iam from "aws-cdk-lib/aws-iam";

export interface ChatLambdaProps {
  cognitoUserPoolId: string;
  cognitoClientId: string;
  workspaceTableName: string;
  workspaceTableArn: string;
  membershipsTableName: string;
  membershipsTableArn: string;
  userSessionsTableName: string;
  userSessionsTableArn: string;
  openRouterSecretArn: string;
  gatewayBaseUrl: string;
  corsOrigins: string[];
  posthogProjectApiKey?: string;
  posthogPersonalApiKey?: string;
}

/**
 * Patchwork chat backend Lambda.
 *
 * Ships as a streaming Function URL (invokeMode: RESPONSE_STREAM, authType: NONE).
 * JWT verification and plan-gating happen inside the Hono handler; CloudFront
 * acts as the public front door. Intentionally not derived from any AppLambda
 * base class — auth, transport, and streaming semantics differ enough that
 * sharing would produce coupling rather than reuse.
 */
export class ChatLambda extends Construct {
  public readonly fn: nodejs.NodejsFunction;
  public readonly functionUrl: lambda.FunctionUrl;

  constructor(scope: Construct, id: string, props: ChatLambdaProps) {
    super(scope, id);

    const stack = cdk.Stack.of(this);

    // Monorepo root: apps/platform/src/lambdas → ../../../../
    const monorepoRoot = path.join(__dirname, "../../../../");

    this.fn = new nodejs.NodejsFunction(this, "Function", {
      description: "Patchwork chat backend — Cognito auth + OpenRouter streaming + plan gate",
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 1024,
      timeout: cdk.Duration.seconds(120),
      // projectRoot must cover both apps/platform and apps/chat-api
      projectRoot: monorepoRoot,
      entry: path.join(monorepoRoot, "apps/chat-api/src/lambda.ts"),
      handler: "handler",
      bundling: {
        minify: true,
        sourceMap: true,
        // Lambda runtime ships @aws-sdk; bundle everything else
        externalModules: ["@aws-sdk/*"],
      },
      environment: {
        NODE_ENV: "production",
        COGNITO_USER_POOL_ID: props.cognitoUserPoolId,
        COGNITO_CLIENT_ID: props.cognitoClientId,
        WORKSPACE_TABLE_NAME: props.workspaceTableName,
        MEMBERSHIPS_TABLE_NAME: props.membershipsTableName,
        USER_SESSIONS_TABLE_NAME: props.userSessionsTableName,
        OPENROUTER_SECRET_ARN: props.openRouterSecretArn,
        GATEWAY_URL: props.gatewayBaseUrl,
        ...(props.posthogProjectApiKey !== undefined && {
          POSTHOG_PROJECT_API_KEY: props.posthogProjectApiKey,
        }),
        ...(props.posthogPersonalApiKey !== undefined && {
          POSTHOG_PERSONAL_API_KEY: props.posthogPersonalApiKey,
        }),
      },
    });

    // secretsmanager:GetSecretValue scoped to /aprovan/chat/* (covers per-env paths)
    this.fn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["secretsmanager:GetSecretValue"],
        resources: [
          `arn:aws:secretsmanager:${stack.region}:${stack.account}:secret:/aprovan/chat/*`,
        ],
      }),
    );

    // dynamodb:GetItem on workspace table (plan middleware)
    this.fn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["dynamodb:GetItem"],
        resources: [props.workspaceTableArn],
      }),
    );

    // dynamodb:Query on memberships table + ByUserSub GSI (workspace middleware)
    this.fn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["dynamodb:Query"],
        resources: [
          props.membershipsTableArn,
          `${props.membershipsTableArn}/index/ByUserSub`,
        ],
      }),
    );

    // dynamodb:GetItem + PutItem on user sessions table (active workspace session)
    this.fn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["dynamodb:GetItem", "dynamodb:PutItem"],
        resources: [props.userSessionsTableArn],
      }),
    );

    // Function URL: RESPONSE_STREAM so chunks reach the client incrementally.
    // authType: NONE — JWT is verified by the Hono auth middleware in the handler.
    // Note: OAC (CloudFront Origin Access Control) requires authType: AWS_IAM;
    // restricting invocations to CloudFront only is tracked as a follow-up.
    this.functionUrl = this.fn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      invokeMode: lambda.InvokeMode.RESPONSE_STREAM,
      cors: {
        allowedOrigins: props.corsOrigins,
        allowedHeaders: ["authorization", "content-type"],
        allowedMethods: [lambda.HttpMethod.ALL],
        maxAge: cdk.Duration.hours(24),
      },
    });
  }
}
