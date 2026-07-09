import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import type { MiddlewareHandler } from "hono";
import type { AppVariables, WorkspaceItem } from "../types";

const WORKSPACE_CACHE_TTL_MS = 60_000;

interface CacheEntry {
  workspace: WorkspaceItem;
  fetchedAt: number;
}

const workspaceCache = new Map<string, CacheEntry>();

let ddbClient: DynamoDBDocumentClient | null = null;

function getDdb() {
  if (!ddbClient) {
    ddbClient = DynamoDBDocumentClient.from(
      new DynamoDBClient({ region: process.env["AWS_REGION"] }),
    );
  }
  return ddbClient;
}

export async function getWorkspace(workspaceId: string): Promise<WorkspaceItem | null> {
  const now = Date.now();
  const cached = workspaceCache.get(workspaceId);
  if (cached && now - cached.fetchedAt < WORKSPACE_CACHE_TTL_MS) {
    return cached.workspace;
  }

  const result = await getDdb().send(
    new GetCommand({
      TableName: process.env["WORKSPACE_TABLE_NAME"]!,
      Key: { workspaceId },
    }),
  );

  if (!result.Item) return null;

  const workspace = result.Item as WorkspaceItem;
  workspaceCache.set(workspaceId, { workspace, fetchedAt: now });
  return workspace;
}

export const planMiddleware: MiddlewareHandler<{ Variables: AppVariables }> =
  async (c, next) => {
    const workspaceId = c.get("workspaceId");
    const workspace = await getWorkspace(workspaceId);
    if (!workspace) {
      return c.json({ error: "Workspace not found" }, 404);
    }

    // 402 Payment Required when chat is not included in the plan.
    // Currently all plans include chat; this gate is a forward-looking hook
    // for future restricted plans where chat is a paid add-on.
    if ("chat" in workspace.features && !workspace.features.chat) {
      return c.json(
        { error: "Chat is not available on your current plan", plan: workspace.plan },
        402,
      );
    }

    c.set("workspace", workspace);
    return next();
  };
