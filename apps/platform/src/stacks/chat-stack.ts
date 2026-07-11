import { Construct } from "constructs";
import * as cdk from "aws-cdk-lib";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import { ChatLambda } from "../lambdas/chat-lambda";

export interface ChatStackProps extends cdk.StackProps {
  env: Required<cdk.Environment>;

  cognitoUserPoolId: string;
  cognitoClientId: string;
  workspaceTableName: string;
  workspaceTableArn: string;
  membershipsTableName: string;
  membershipsTableArn: string;
  openRouterSecretArn: string;
  gatewayBaseUrl: string;

  /**
   * Subdomain for this environment's CloudFront distribution.
   * Example: "chat.dev.aprovan.com"
   */
  domainName: string;
  /**
   * ARN of an ACM certificate in us-east-1 covering the domainName above.
   * CloudFront requires certificates to be in us-east-1 regardless of the
   * Lambda's region.
   */
  certificateArn: string;

  /** Origins allowed by Function URL CORS and forwarded by CloudFront */
  corsOrigins: string[];

  posthogProjectApiKey?: string;
  posthogPersonalApiKey?: string;
}

/**
 * Full chat backend stack: ChatLambda (Function URL, RESPONSE_STREAM)
 * behind a CloudFront distribution with a custom domain.
 *
 * WAF integration is intentionally omitted here; attach a WebACL to the
 * distribution (distributionArn output) as a follow-up.
 */
export class ChatStack extends cdk.Stack {
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: ChatStackProps) {
    super(scope, id, props);

    // --- User sessions DDB table -----------------------------------------
    const userSessionsTable = new dynamodb.Table(this, "UserSessionsTable", {
      tableName: `${id}-user-sessions`,
      partitionKey: { name: "userSub", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    });

    // --- Lambda + Function URL -------------------------------------------
    const chat = new ChatLambda(this, "ChatLambda", {
      cognitoUserPoolId: props.cognitoUserPoolId,
      cognitoClientId: props.cognitoClientId,
      workspaceTableName: props.workspaceTableName,
      workspaceTableArn: props.workspaceTableArn,
      membershipsTableName: props.membershipsTableName,
      membershipsTableArn: props.membershipsTableArn,
      userSessionsTableName: userSessionsTable.tableName,
      userSessionsTableArn: userSessionsTable.tableArn,
      openRouterSecretArn: props.openRouterSecretArn,
      gatewayBaseUrl: props.gatewayBaseUrl,
      corsOrigins: props.corsOrigins,
      posthogProjectApiKey: props.posthogProjectApiKey,
      posthogPersonalApiKey: props.posthogPersonalApiKey,
    });

    // Extract hostname from the Function URL for use as the CloudFront origin.
    // The URL has the shape: https://<id>.lambda-url.<region>.on.aws
    const fnUrlHostname = cdk.Fn.select(2, cdk.Fn.split("/", chat.functionUrl.url));

    const origin = new origins.HttpOrigin(fnUrlHostname, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
      // Function URL does not support HTTP/2 origin connections at this time
      httpsPort: 443,
    });

    // --- Cache policies --------------------------------------------------
    // No caching anywhere — this is a pure API backend and /api/chat is SSE.
    const noCachePolicy = cloudfront.CachePolicy.CACHING_DISABLED;

    // Forward Authorization + Content-Type to the origin (needed for JWT
    // verification and the AI SDK's JSON body). Also forward Origin so the
    // Lambda can echo CORS response headers.
    const apiOriginRequestPolicy = new cloudfront.OriginRequestPolicy(
      this,
      "ApiOriginRequestPolicy",
      {
        originRequestPolicyName: `${id}-api-origin`,
        headerBehavior: cloudfront.OriginRequestHeaderBehavior.allowList(
          "Authorization",
          "Content-Type",
          "Origin",
          "Accept",
          "Accept-Encoding",
        ),
        queryStringBehavior: cloudfront.OriginRequestQueryStringBehavior.all(),
        cookieBehavior: cloudfront.OriginRequestCookieBehavior.none(),
      },
    );

    // --- CloudFront distribution -----------------------------------------
    const certificate = acm.Certificate.fromCertificateArn(
      this,
      "Cert",
      props.certificateArn,
    );

    this.distribution = new cloudfront.Distribution(this, "Distribution", {
      comment: `Patchwork chat API — ${props.domainName}`,
      domainNames: [props.domainName],
      certificate,
      // Default behavior: all API traffic, no caching, forward auth headers
      defaultBehavior: {
        origin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
        cachePolicy: noCachePolicy,
        originRequestPolicy: apiOriginRequestPolicy,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
        // Disable compression for SSE paths to avoid buffering
        compress: false,
      },
      additionalBehaviors: {
        // Explicit /api/chat rule so intent is clear even though the default
        // already covers it. Keeps a narrower compress:false scope in case
        // static assets are ever added to this distribution.
        "/api/chat": {
          origin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          cachePolicy: noCachePolicy,
          originRequestPolicy: apiOriginRequestPolicy,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
          compress: false,
        },
      },
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      enableLogging: false,
    });

    // --- Outputs ---------------------------------------------------------
    new cdk.CfnOutput(this, "DistributionDomainName", {
      value: this.distribution.distributionDomainName,
      description: "CloudFront distribution domain (CNAME this in DNS)",
    });

    new cdk.CfnOutput(this, "DistributionId", {
      value: this.distribution.distributionId,
      description: "CloudFront distribution ID (for WAF WebACL attachment follow-up)",
    });

    new cdk.CfnOutput(this, "FunctionUrl", {
      value: chat.functionUrl.url,
      description: "Lambda Function URL (direct access, bypass CloudFront for debugging only)",
    });

    new cdk.CfnOutput(this, "ChatEndpoint", {
      value: `https://${props.domainName}`,
      description: "Public chat API base URL",
    });
  }
}
