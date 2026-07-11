import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { MiddlewareHandler } from "hono";
import type { AppVariables } from "../types.js";

const MEMBERSHIP_CACHE_TTL_MS = 300_000;

interface CacheEntry {
  workspaceIds: string[];
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

/** Returns all workspace IDs the user is a member of. Empty array = no memberships. */
export async function listWorkspaceMemberships(
  userSub: string,
): Promise<string[]> {
  const now = Date.now();
  const cached = membershipCache.get(userSub);
  if (cached && now - cached.fetchedAt < MEMBERSHIP_CACHE_TTL_MS) {
    return cached.workspaceIds;
  }

  const result = await getDdb().send(
    new QueryCommand({
      TableName: process.env["MEMBERSHIPS_TABLE_NAME"]!,
      IndexName: "ByUserSub",
      KeyConditionExpression: "userSub = :sub",
      ExpressionAttributeValues: { ":sub": userSub },
    }),
  );

  const workspaceIds = (result.Items ?? []).map(
    (item) => (item as { workspaceId: string }).workspaceId,
  );
  membershipCache.set(userSub, { workspaceIds, fetchedAt: now });
  return workspaceIds;
}

export function clearMembershipCache(userSub: string): void {
  membershipCache.delete(userSub);
}

export function resetMembershipCache(): void {
  membershipCache.clear();
}

/**
 * Resolves the active workspace ID for the user:
 * 1. Check the Users table for an explicit activeWorkspaceId.
 * 2. Fall back to the first membership if no activeWorkspaceId.
 */
export async function resolveWorkspaceId(userSub: string): Promise<string | null> {
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
    return userItem.activeWorkspaceId;
  }

  // Fall back to first membership
  const workspaceIds = await listWorkspaceMemberships(userSub);
  return workspaceIds[0] ?? null;
}

export const workspaceMiddleware: MiddlewareHandler<{
  Variables: AppVariables;
}> = async (c, next) => {
  const claims = c.get("claims");
  const workspaceId = await resolveWorkspaceId(claims.sub);
  if (!workspaceId) {
    return c.json({ error: "No workspace membership" }, 403);
  }
  c.set("workspaceId", workspaceId);
  return next();
};
