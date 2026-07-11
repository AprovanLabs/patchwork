import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { Hono } from "hono";
import { evictWorkspaceCache } from "../middleware/workspace.js";
import type { AppVariables } from "../types.js";

let ddbClient: DynamoDBDocumentClient | null = null;

function getDdb() {
  if (!ddbClient) {
    ddbClient = DynamoDBDocumentClient.from(
      new DynamoDBClient({ region: process.env["AWS_REGION"] }),
    );
  }
  return ddbClient;
}

export const workspaceRoute = new Hono<{ Variables: AppVariables }>();

/** POST /api/workspace — switch the caller's active workspace. */
workspaceRoute.post("/", async (c) => {
  const claims = c.get("claims");
  const body = await c.req.json<{ workspaceId?: string }>();
  const workspaceId = body?.workspaceId;
  if (!workspaceId || typeof workspaceId !== "string") {
    return c.json({ error: "workspaceId is required" }, 400);
  }

  await getDdb().send(
    new UpdateCommand({
      TableName: process.env["USERS_TABLE_NAME"]!,
      Key: { sub: claims.sub },
      UpdateExpression: "SET activeWorkspaceId = :ws",
      ExpressionAttributeValues: { ":ws": workspaceId },
    }),
  );

  evictWorkspaceCache(claims.sub);

  return c.json({ activeWorkspaceId: workspaceId });
});
