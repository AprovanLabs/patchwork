import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { getSessionWorkspaceId } from "../session.js";
import type { AppVariables } from "../types.js";
import type { MiddlewareHandler } from "hono";

 

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
 * 1. Check the session table for an explicit activeWorkspaceId.
 * 2. Verify the user still has membership for that workspace.
 * 3. Fall back to the first membership if no session preference or membership expired.
 */
export async function resolveWorkspaceId(
  userSub: string,
): Promise<string | null> {
  const [sessionWsId, workspaceIds] = await Promise.all([
    getSessionWorkspaceId(userSub),
    listWorkspaceMemberships(userSub),
  ]);

  if (workspaceIds.length === 0) return null;

  if (sessionWsId && workspaceIds.includes(sessionWsId)) {
    return sessionWsId;
  }

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
