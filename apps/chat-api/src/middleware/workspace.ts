import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { MiddlewareHandler } from "hono";
import type { AppVariables } from "../types";

const MEMBERSHIP_CACHE_TTL_MS = 300_000;

interface CacheEntry {
  workspaceId: string;
  fetchedAt: number;
}

const membershipCache = new Map<string, CacheEntry>();

let ddbClient: DynamoDBDocumentClient | null = null;

function getDdb() {
  if (!ddbClient) {
    ddbClient = DynamoDBDocumentClient.from(
      new DynamoDBClient({ region: process.env["AWS_REGION"] }),
    );
  }
  return ddbClient;
}

export async function resolveWorkspaceId(userSub: string): Promise<string | null> {
  const now = Date.now();
  const cached = membershipCache.get(userSub);
  if (cached && now - cached.fetchedAt < MEMBERSHIP_CACHE_TTL_MS) {
    return cached.workspaceId;
  }

  const result = await getDdb().send(
    new QueryCommand({
      TableName: process.env["MEMBERSHIPS_TABLE_NAME"]!,
      IndexName: "ByUserSub",
      KeyConditionExpression: "userSub = :sub",
      ExpressionAttributeValues: { ":sub": userSub },
      Limit: 1,
    }),
  );

  const item = result.Items?.[0] as { workspaceId: string } | undefined;
  if (!item) return null;

  membershipCache.set(userSub, { workspaceId: item.workspaceId, fetchedAt: now });
  return item.workspaceId;
}

export const workspaceMiddleware: MiddlewareHandler<{ Variables: AppVariables }> =
  async (c, next) => {
    const claims = c.get("claims");
    const workspaceId = await resolveWorkspaceId(claims.sub);
    if (!workspaceId) {
      return c.json({ error: "No workspace membership" }, 403);
    }
    c.set("workspaceId", workspaceId);
    return next();
  };
