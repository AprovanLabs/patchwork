import { ConditionalCheckFailedException, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  DeleteCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Hono } from "hono";
import type { AppVariables } from "../types.js";

export interface VfsChangeEntry {
  path: string;
  mtime: string;
  version: number;
  size: number;
}

interface VfsDdbItem {
  PK: string;
  SK: string;
  s3Key: string;
  size: number;
  mtime: string;
  etag?: string;
  contentHash?: string;
  version: number;
}

let ddbClient: DynamoDBDocumentClient | null = null;
let s3Client: S3Client | null = null;

function getDdb() {
  if (!ddbClient) {
    ddbClient = DynamoDBDocumentClient.from(
      new DynamoDBClient({ region: process.env["AWS_REGION"] }),
    );
  }
  return ddbClient;
}

function getS3() {
  if (!s3Client) {
    s3Client = new S3Client({ region: process.env["AWS_REGION"] });
  }
  return s3Client;
}

function vfsTableName(): string | undefined {
  return process.env["VFS_TABLE_NAME"];
}

function vfsBucketName(): string | undefined {
  return process.env["VFS_BUCKET_NAME"];
}

function pk(wsId: string) {
  return `workspace#${wsId}`;
}

function sk(filePath: string) {
  return `file#${filePath}`;
}

function s3Key(wsId: string, filePath: string) {
  return `${wsId}/${filePath}`;
}

export const vfsRoute = new Hono<{ Variables: AppVariables }>();

/** GET /vfs/config — parity endpoint; tells the client to use path-based addressing. */
vfsRoute.get("/config", (c) => {
  return c.json({ usePaths: true });
});

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

  const tableName = vfsTableName();
  if (!tableName) {
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
        ":pk": pk(workspaceId),
        ":since": sinceDate.toISOString(),
      },
    }),
  );

  const items = (result.Items ?? []) as VfsDdbItem[];
  const changes: VfsChangeEntry[] = items.map((item) => ({
    path: item.SK.replace(/^file#/, ""),
    mtime: item.mtime,
    version: item.version ?? 0,
    size: item.size ?? 0,
  }));

  return c.json(changes);
});

/**
 * HEAD /vfs/:path — check existence. 200 if exists, 404 if not.
 * GET  /vfs/:path — read file, stat, or readdir (query param selects behaviour).
 *
 * HEAD is merged into GET because Hono auto-routes HEAD to the matching GET
 * handler before checking explicit HEAD registrations.
 */
vfsRoute.on(["GET", "HEAD"], "/:path{.+}", async (c) => {
  const isHead = c.req.method === "HEAD";
  const filePath = c.req.param("path");
  const workspaceId = c.get("workspaceId");
  const tableName = vfsTableName();
  const bucketName = vfsBucketName();

  // --- HEAD: existence check ---
  if (isHead) {
    if (!tableName) return c.body(null, 404);
    const result = await getDdb().send(
      new GetCommand({
        TableName: tableName,
        Key: { PK: pk(workspaceId), SK: sk(filePath) },
        ProjectionExpression: "SK",
      }),
    );
    return result.Item ? c.body(null, 200) : c.body(null, 404);
  }

  if (!tableName) {
    return c.json({ error: "VFS not configured" }, 503);
  }

  // --- stat ---
  if (c.req.query("stat") === "true") {
    const result = await getDdb().send(
      new GetCommand({
        TableName: tableName,
        Key: { PK: pk(workspaceId), SK: sk(filePath) },
        ProjectionExpression: "#sz, #mt, version",
        ExpressionAttributeNames: { "#sz": "size", "#mt": "mtime" },
      }),
    );
    if (!result.Item) return c.json({ error: "ENOENT" }, 404);
    const item = result.Item as Pick<VfsDdbItem, "size" | "mtime" | "version">;
    return c.json({
      size: item.size,
      mtime: item.mtime,
      isFile: true,
      isDirectory: false,
    });
  }

  // --- readdir ---
  if (c.req.query("readdir") === "true") {
    const prefix = filePath ? `file#${filePath}/` : "file#";
    const result = await getDdb().send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
        ExpressionAttributeValues: {
          ":pk": pk(workspaceId),
          ":prefix": prefix,
        },
        ProjectionExpression: "SK",
      }),
    );

    const items = (result.Items ?? []) as Array<{ SK: string }>;
    const seen = new Map<string, boolean>();

    for (const item of items) {
      const relativePath = item.SK.slice(prefix.length);
      const slashIdx = relativePath.indexOf("/");
      if (slashIdx === -1) {
        seen.set(relativePath, false);
      } else {
        const dirName = relativePath.slice(0, slashIdx);
        if (!seen.has(dirName)) {
          seen.set(dirName, true);
        }
      }
    }

    const entries = Array.from(seen.entries()).map(([name, isDirectory]) => ({
      name,
      isDirectory,
    }));

    return c.json(entries);
  }

  // --- read file ---
  if (!bucketName) {
    return c.json({ error: "VFS storage not configured" }, 503);
  }

  const fileKey = s3Key(workspaceId, filePath);
  try {
    const obj = await getS3().send(
      new GetObjectCommand({ Bucket: bucketName, Key: fileKey }),
    );
    const body = await obj.Body?.transformToString("utf-8");
    if (body === undefined) return c.json({ error: "ENOENT" }, 404);
    return c.text(body, 200);
  } catch (err: unknown) {
    const code = (err as { name?: string }).name;
    if (code === "NoSuchKey" || code === "NotFound") {
      return c.json({ error: "ENOENT" }, 404);
    }
    throw err;
  }
});

/**
 * PUT /vfs/:path — write file.
 *
 * Optionally accepts `X-Vfs-Expected-Version` header for optimistic concurrency.
 * Returns {ok: true, version: <new>} or {ok: false, conflict: {serverVersion, serverEtag}}.
 */
vfsRoute.put("/:path{.+}", async (c) => {
  const tableName = vfsTableName();
  const bucketName = vfsBucketName();
  if (!tableName || !bucketName) {
    return c.json({ error: "VFS not configured" }, 503);
  }

  const filePath = c.req.param("path");
  const workspaceId = c.get("workspaceId");
  const content = await c.req.text();
  const expectedVersionHeader = c.req.header("X-Vfs-Expected-Version");
  const expectedVersion = expectedVersionHeader !== undefined
    ? parseInt(expectedVersionHeader, 10)
    : undefined;

  const fileKey = s3Key(workspaceId, filePath);
  const now = new Date().toISOString();
  const byteSize = new TextEncoder().encode(content).length;

  await getS3().send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: fileKey,
      Body: content,
      ContentType: "text/plain; charset=utf-8",
    }),
  );

  try {
    const condExpr =
      expectedVersion !== undefined
        ? "attribute_not_exists(PK) OR version = :expected"
        : undefined;

    const exprAttrValues: Record<string, unknown> = {
      ":mtime": now,
      ":sz": byteSize,
      ":s3Key": fileKey,
      ":inc": 1,
      ":zero": 0,
    };
    if (expectedVersion !== undefined) {
      exprAttrValues[":expected"] = expectedVersion;
    }

    const result = await getDdb().send(
      new UpdateCommand({
        TableName: tableName,
        Key: { PK: pk(workspaceId), SK: sk(filePath) },
        UpdateExpression:
          "SET #mt = :mtime, #sz = :sz, s3Key = :s3Key, version = if_not_exists(version, :zero) + :inc",
        ExpressionAttributeNames: { "#mt": "mtime", "#sz": "size" },
        ExpressionAttributeValues: exprAttrValues,
        ...(condExpr ? { ConditionExpression: condExpr } : {}),
        ReturnValues: "ALL_NEW",
      }),
    );

    const newVersion = (result.Attributes as VfsDdbItem | undefined)?.version ?? 1;
    return c.json({ ok: true, version: newVersion });
  } catch (err: unknown) {
    if (err instanceof ConditionalCheckFailedException) {
      const metaResult = await getDdb().send(
        new GetCommand({
          TableName: tableName,
          Key: { PK: pk(workspaceId), SK: sk(filePath) },
          ProjectionExpression: "version, etag",
        }),
      );
      const item = metaResult.Item as Pick<VfsDdbItem, "version" | "etag"> | undefined;
      return c.json(
        {
          ok: false,
          conflict: {
            serverVersion: item?.version ?? 0,
            serverEtag: item?.etag,
          },
        },
        409,
      );
    }
    throw err;
  }
});

/** DELETE /vfs/:path — remove from S3 + DDB. */
vfsRoute.delete("/:path{.+}", async (c) => {
  const tableName = vfsTableName();
  const bucketName = vfsBucketName();
  if (!tableName || !bucketName) {
    return c.json({ error: "VFS not configured" }, 503);
  }

  const filePath = c.req.param("path");
  const workspaceId = c.get("workspaceId");
  const fileKey = s3Key(workspaceId, filePath);

  await Promise.all([
    getDdb().send(
      new DeleteCommand({
        TableName: tableName,
        Key: { PK: pk(workspaceId), SK: sk(filePath) },
      }),
    ),
    getS3().send(
      new DeleteObjectCommand({ Bucket: bucketName, Key: fileKey }),
    ),
  ]);

  return c.body(null, 204);
});

/** POST /vfs/:path?mkdir=true — no-op (S3 is keyless). */
vfsRoute.post("/:path{.+}", (c) => {
  if (c.req.query("mkdir") === "true") {
    return c.body(null, 204);
  }
  return c.json({ error: "unsupported operation" }, 400);
});
