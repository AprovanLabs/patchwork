import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
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

/** Remove a user's cached workspace so the next request re-derives it. */
export function evictWorkspaceCache(userSub: string): void {
  membershipCache.delete(userSub);
}

export async function resolveWorkspaceId(userSub: string): Promise<string | null> {
  const now = Date.now();
  const cached = membershipCache.get(userSub);
  if (cached && now - cached.fetchedAt < MEMBERSHIP_CACHE_TTL_MS) {
    return cached.workspaceId;
  }

  // Prefer the durable Users table (activeWorkspaceId); fall back to first Membership.
  const usersResult = await getDdb().send(
    new GetCommand({
      TableName: process.env["USERS_TABLE_NAME"]!,
      Key: { sub: userSub },
      ProjectionExpression: "activeWorkspaceId",
    }),
  );
  const userItem = usersResult.Item as { activeWorkspaceId?: string } | undefined;
  if (userItem?.activeWorkspaceId) {
    membershipCache.set(userSub, { workspaceId: userItem.activeWorkspaceId, fetchedAt: now });
    return userItem.activeWorkspaceId;
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
