import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { Hono } from "hono";
import type { AppVariables } from "../types.js";

export interface VfsChangeEntry {
  path: string;
  mtime: string;
  version: number;
  size: number;
}

let ddbClient: DynamoDBDocumentClient | null = null;

function getDdb() {
  if (!ddbClient) {
    ddbClient = DynamoDBDocumentClient.from(
      new DynamoDBClient({ region: process.env["AWS_REGION"] }),
    );
  }
  return ddbClient;
}

export const vfsRoute = new Hono<{ Variables: AppVariables }>();

/**
 * GET /vfs?since=<RFC3339>
 *
 * Returns a list of workspace files whose mtime is strictly after :since.
 * The workspace is resolved from the caller's session — the URL carries no wsId.
 *
 * If VFS_TABLE_NAME is not set (infra not yet deployed) returns [] so the
 * polling client degrades gracefully.
 */
vfsRoute.get("/", async (c) => {
  const since = c.req.query("since");
  if (!since) {
    return c.json({ error: "since query parameter is required" }, 400);
  }

  const sinceDate = new Date(since);
  if (isNaN(sinceDate.getTime())) {
    return c.json({ error: "since must be a valid RFC3339 timestamp" }, 400);
  }

  const tableName = process.env["VFS_TABLE_NAME"];
  if (!tableName) {
    // Infra not deployed yet — return empty so polling degrades gracefully.
    return c.json([] as VfsChangeEntry[]);
  }

  const workspaceId = c.get("workspaceId");

  const result = await getDdb().send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: "PK = :pk",
      FilterExpression: "#mtime > :since",
      ExpressionAttributeNames: { "#mtime": "mtime" },
      ExpressionAttributeValues: {
        ":pk": `workspace#${workspaceId}`,
        ":since": sinceDate.toISOString(),
      },
    }),
  );

  const items = (result.Items ?? []) as Array<{
    SK: string;
    mtime: string;
    version?: number;
    size?: number;
  }>;

  const changes: VfsChangeEntry[] = items.map((item) => ({
    path: item.SK.replace(/^file#/, ""),
    mtime: item.mtime,
    version: item.version ?? 0,
    size: item.size ?? 0,
  }));

  return c.json(changes);
});
