import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { BatchGetCommand, DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { listWorkspaceMemberships } from "../middleware/workspace.js";
import { getSessionWorkspaceId, setSessionWorkspaceId } from "../session.js";
import type { AppVariables, WorkspaceItem } from "../types.js";

let ddbClient: DynamoDBDocumentClient | null = null;

function getDdb() {
  if (!ddbClient) {
    ddbClient = DynamoDBDocumentClient.from(
      new DynamoDBClient({ region: process.env["AWS_REGION"] }),
    );
  }
  return ddbClient;
}

async function batchGetWorkspaces(
  workspaceIds: string[],
): Promise<WorkspaceItem[]> {
  if (workspaceIds.length === 0) return [];
  const tableName = process.env["WORKSPACE_TABLE_NAME"]!;
  const result = await getDdb().send(
    new BatchGetCommand({
      RequestItems: {
        [tableName]: { Keys: workspaceIds.map((id) => ({ workspaceId: id })) },
      },
    }),
  );
  return (result.Responses?.[tableName] ?? []) as WorkspaceItem[];
}

export const workspacesRoute = new Hono<{ Variables: AppVariables }>();

workspacesRoute.get("/", async (c) => {
  const claims = c.get("claims");
  const userSub = claims.sub;

  const [workspaceIds, activeWorkspaceId] = await Promise.all([
    listWorkspaceMemberships(userSub),
    getSessionWorkspaceId(userSub),
  ]);

  const workspaces = await batchGetWorkspaces(workspaceIds);

  const effectiveActiveId =
    activeWorkspaceId && workspaceIds.includes(activeWorkspaceId)
      ? activeWorkspaceId
      : (workspaceIds[0] ?? null);

  const sorted = workspaceIds
    .map((id) => workspaces.find((w) => w.workspaceId === id))
    .filter((w): w is WorkspaceItem => w !== undefined);

  return c.json({
    workspaces: sorted.map((w) => ({
      workspaceId: w.workspaceId,
      name: w.name,
      plan: w.plan,
      active: w.workspaceId === effectiveActiveId,
    })),
    activeWorkspaceId: effectiveActiveId,
  });
});

const setActiveSchema = z.object({
  workspaceId: z.string().min(1),
});

workspacesRoute.put(
  "/active",
  zValidator("json", setActiveSchema),
  async (c) => {
    const claims = c.get("claims");
    const userSub = claims.sub;
    const { workspaceId } = c.req.valid("json");

    const workspaceIds = await listWorkspaceMemberships(userSub);
    if (!workspaceIds.includes(workspaceId)) {
      return c.json({ error: "Not a member of this workspace" }, 403);
    }

    await setSessionWorkspaceId(userSub, workspaceId);
    return c.json({ activeWorkspaceId: workspaceId });
  },
);
