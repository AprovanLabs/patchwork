import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";

const SESSION_CACHE_TTL_MS = 15_000;

interface SessionCacheEntry {
  activeWorkspaceId: string | null;
  fetchedAt: number;
}

const sessionCache = new Map<string, SessionCacheEntry>();

let ddbClient: DynamoDBDocumentClient | null = null;

function getDdb() {
  if (!ddbClient) {
    ddbClient = DynamoDBDocumentClient.from(
      new DynamoDBClient({ region: process.env["AWS_REGION"] }),
    );
  }
  return ddbClient;
}

function tableName(): string {
  return process.env["USER_SESSIONS_TABLE_NAME"]!;
}

export async function getSessionWorkspaceId(
  userSub: string,
): Promise<string | null> {
  const now = Date.now();
  const cached = sessionCache.get(userSub);
  if (cached && now - cached.fetchedAt < SESSION_CACHE_TTL_MS) {
    return cached.activeWorkspaceId;
  }

  const result = await getDdb().send(
    new GetCommand({
      TableName: tableName(),
      Key: { userSub },
    }),
  );

  const activeWorkspaceId =
    (result.Item?.activeWorkspaceId as string | undefined) ?? null;
  sessionCache.set(userSub, { activeWorkspaceId, fetchedAt: now });
  return activeWorkspaceId;
}

export async function setSessionWorkspaceId(
  userSub: string,
  workspaceId: string,
): Promise<void> {
  await getDdb().send(
    new PutCommand({
      TableName: tableName(),
      Item: {
        userSub,
        activeWorkspaceId: workspaceId,
        updatedAt: new Date().toISOString(),
      },
    }),
  );
  sessionCache.set(userSub, {
    activeWorkspaceId: workspaceId,
    fetchedAt: Date.now(),
  });
}

export function clearSessionCache(userSub: string): void {
  sessionCache.delete(userSub);
}

export function resetSessionCache(): void {
  sessionCache.clear();
}
