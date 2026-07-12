import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import type { CognitoAccessTokenPayload } from "aws-jwt-verify/jwt-model";

vi.mock("aws-jwt-verify", () => {
  const verify = vi.fn();
  return {
    CognitoJwtVerifier: {
      create: vi.fn(() => ({ verify })),
    },
  };
});

vi.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: vi.fn(() => ({})),
  ConditionalCheckFailedException: class ConditionalCheckFailedException extends Error {
    name = "ConditionalCheckFailedException";
  },
}));

const mockDdbSend = vi.fn();
vi.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: {
    from: vi.fn(() => ({ send: mockDdbSend })),
  },
  UpdateCommand: vi.fn((input) => input),
  GetCommand: vi.fn((input) => input),
  QueryCommand: vi.fn((input) => input),
  DeleteCommand: vi.fn((input) => input),
}));

const mockS3Send = vi.fn();
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn(() => ({ send: mockS3Send })),
  GetObjectCommand: vi.fn((input) => input),
  PutObjectCommand: vi.fn((input) => input),
  DeleteObjectCommand: vi.fn((input) => input),
}));

beforeAll(() => {
  process.env["COGNITO_USER_POOL_ID"] = "us-east-1_test";
  process.env["COGNITO_CLIENT_ID"] = "test-client-id";
  process.env["AWS_REGION"] = "us-east-1";
  process.env["WORKSPACE_TABLE_NAME"] = "test-workspaces";
  process.env["MEMBERSHIPS_TABLE_NAME"] = "test-memberships";
  process.env["USERS_TABLE_NAME"] = "test-users";
  process.env["USER_SESSIONS_TABLE_NAME"] = "test-sessions";
});

const { createChatApp } = await import("../../src/app");

const USER_SUB = "vfs-test-unique-user-sub";
const WORKSPACE_ID = "ws-test-vfs-123";
const BEARER = "Bearer valid.token.here";

async function setupAuth() {
  const { CognitoJwtVerifier } = await import("aws-jwt-verify");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (CognitoJwtVerifier.create({} as any) as any).verify.mockResolvedValue({
    sub: USER_SUB,
  } as unknown as CognitoAccessTokenPayload);
}

/**
 * Install a mockImplementation that dispatches on table name so the workspace
 * middleware's cache behaviour (hit vs miss) never affects VFS query mocks.
 * Workspace calls go to "test-users"; VFS calls go to the optional "test-vfs".
 */
function setupDdbRouter(vfsItems?: Array<Record<string, unknown>>) {
  mockDdbSend.mockImplementation(
    (command: { TableName?: string; Key?: unknown }) => {
      if (command.TableName === "test-users") {
        // Workspace resolution — GetCommand
        return Promise.resolve({ Item: { activeWorkspaceId: WORKSPACE_ID } });
      }
      if (command.TableName === "test-memberships") {
        // Fallback membership query (should not be reached)
        return Promise.resolve({ Items: [{ workspaceId: WORKSPACE_ID }] });
      }
      if (command.TableName === "test-vfs") {
        return Promise.resolve({ Items: vfsItems ?? [] });
      }
      return Promise.resolve({});
    },
  );
}

describe("GET /vfs?since=", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env["VFS_TABLE_NAME"];
  });

  it("returns 401 without Authorization header", async () => {
    const app = createChatApp();
    const res = await app.request("/vfs?since=2026-01-01T00:00:00Z");
    expect(res.status).toBe(401);
  });

  it("returns 400 when since is missing", async () => {
    await setupAuth();
    setupDdbRouter();

    const app = createChatApp();
    const res = await app.request("/vfs", {
      headers: { Authorization: BEARER },
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/since/);
  });

  it("returns 400 when since is not a valid date", async () => {
    await setupAuth();
    setupDdbRouter();

    const app = createChatApp();
    const res = await app.request("/vfs?since=not-a-date", {
      headers: { Authorization: BEARER },
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/RFC3339/);
  });

  it("returns [] when VFS_TABLE_NAME is not configured", async () => {
    await setupAuth();
    setupDdbRouter();

    const app = createChatApp();
    const res = await app.request("/vfs?since=2026-01-01T00:00:00Z", {
      headers: { Authorization: BEARER },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  it("queries DDB and returns changed files when table is configured", async () => {
    process.env["VFS_TABLE_NAME"] = "test-vfs";
    await setupAuth();

    const since = "2026-07-01T00:00:00.000Z";
    const fakeItems = [
      { SK: "file#src/index.ts", mtime: "2026-07-11T10:00:00.000Z", version: 3, size: 512 },
      { SK: "file#src/app.tsx", mtime: "2026-07-11T10:05:00.000Z", version: 1, size: 1024 },
    ];
    setupDdbRouter(fakeItems);

    const app = createChatApp();
    const res = await app.request(`/vfs?since=${encodeURIComponent(since)}`, {
      headers: { Authorization: BEARER },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ path: string; mtime: string; version: number; size: number }>;
    expect(body).toHaveLength(2);
    expect(body[0]).toMatchObject({ path: "src/index.ts", version: 3, size: 512 });
    expect(body[1]).toMatchObject({ path: "src/app.tsx", version: 1, size: 1024 });

    // Verify the VFS query used the right PK and since filter.
    const vfsCall = mockDdbSend.mock.calls
      .map((c) => c[0] as { TableName?: string; ExpressionAttributeValues?: Record<string, unknown> })
      .find((c) => c.TableName === "test-vfs");
    expect(vfsCall).toBeDefined();
    expect(vfsCall!.ExpressionAttributeValues?.[":pk"]).toBe(`workspace#${WORKSPACE_ID}`);
    expect(vfsCall!.ExpressionAttributeValues?.[":since"]).toBe(since);
  });

  it("strips file# prefix from SK in the response path", async () => {
    process.env["VFS_TABLE_NAME"] = "test-vfs";
    await setupAuth();
    setupDdbRouter([{ SK: "file#components/Button.tsx", mtime: "2026-07-11T00:00:00.000Z" }]);

    const app = createChatApp();
    const res = await app.request("/vfs?since=2026-01-01T00:00:00Z", {
      headers: { Authorization: BEARER },
    });

    const body = await res.json() as Array<{ path: string }>;
    expect(body[0]?.path).toBe("components/Button.tsx");
  });
});

describe("GET /vfs/config", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await setupAuth();
    setupDdbRouter();
  });

  it("returns { usePaths: true }", async () => {
    const app = createChatApp();
    const res = await app.request("/vfs/config", {
      headers: { Authorization: BEARER },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { usePaths: boolean };
    expect(body.usePaths).toBe(true);
  });
});

describe("HEAD /vfs/:path", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await setupAuth();
    process.env["VFS_TABLE_NAME"] = "test-vfs";
  });

  it("returns 404 when VFS_TABLE_NAME is not set", async () => {
    delete process.env["VFS_TABLE_NAME"];
    setupDdbRouter();
    const app = createChatApp();
    const res = await app.request("/vfs/src/index.ts", { method: "HEAD", headers: { Authorization: BEARER } });
    expect(res.status).toBe(404);
  });

  it("returns 200 when item exists in DDB", async () => {
    mockDdbSend.mockImplementation((cmd: { TableName?: string; Key?: unknown }) => {
      if (cmd.TableName === "test-users") return Promise.resolve({ Item: { activeWorkspaceId: WORKSPACE_ID } });
      if (cmd.TableName === "test-vfs") return Promise.resolve({ Item: { SK: "file#src/index.ts" } });
      return Promise.resolve({});
    });

    const app = createChatApp();
    const res = await app.request("/vfs/src/index.ts", { method: "HEAD", headers: { Authorization: BEARER } });
    expect(res.status).toBe(200);
  });

  it("returns 404 when item not found in DDB", async () => {
    mockDdbSend.mockImplementation((cmd: { TableName?: string }) => {
      if (cmd.TableName === "test-users") return Promise.resolve({ Item: { activeWorkspaceId: WORKSPACE_ID } });
      if (cmd.TableName === "test-vfs") return Promise.resolve({ Item: undefined });
      return Promise.resolve({});
    });

    const app = createChatApp();
    const res = await app.request("/vfs/missing.ts", { method: "HEAD", headers: { Authorization: BEARER } });
    expect(res.status).toBe(404);
  });
});

describe("GET /vfs/:path?stat=true", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await setupAuth();
    process.env["VFS_TABLE_NAME"] = "test-vfs";
  });

  it("returns file metadata from DDB", async () => {
    mockDdbSend.mockImplementation((cmd: { TableName?: string }) => {
      if (cmd.TableName === "test-users") return Promise.resolve({ Item: { activeWorkspaceId: WORKSPACE_ID } });
      if (cmd.TableName === "test-vfs") return Promise.resolve({
        Item: { size: 1024, mtime: "2026-07-11T00:00:00.000Z", version: 5 },
      });
      return Promise.resolve({});
    });

    const app = createChatApp();
    const res = await app.request("/vfs/src/index.ts?stat=true", { headers: { Authorization: BEARER } });
    expect(res.status).toBe(200);
    const body = await res.json() as { size: number; mtime: string; isFile: boolean; isDirectory: boolean };
    expect(body.size).toBe(1024);
    expect(body.isFile).toBe(true);
    expect(body.isDirectory).toBe(false);
  });

  it("returns 404 when file not in DDB", async () => {
    mockDdbSend.mockImplementation((cmd: { TableName?: string }) => {
      if (cmd.TableName === "test-users") return Promise.resolve({ Item: { activeWorkspaceId: WORKSPACE_ID } });
      if (cmd.TableName === "test-vfs") return Promise.resolve({ Item: undefined });
      return Promise.resolve({});
    });

    const app = createChatApp();
    const res = await app.request("/vfs/nope.ts?stat=true", { headers: { Authorization: BEARER } });
    expect(res.status).toBe(404);
  });
});

describe("GET /vfs/:path?readdir=true", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await setupAuth();
    process.env["VFS_TABLE_NAME"] = "test-vfs";
  });

  it("collapses DDB items to one-level directory entries", async () => {
    // Mock returns only items that DDB's begins_with(SK, "file#src/") would select.
    mockDdbSend.mockImplementation((cmd: { TableName?: string }) => {
      if (cmd.TableName === "test-users") return Promise.resolve({ Item: { activeWorkspaceId: WORKSPACE_ID } });
      if (cmd.TableName === "test-vfs") return Promise.resolve({
        Items: [
          { SK: "file#src/index.ts" },
          { SK: "file#src/app.tsx" },
          { SK: "file#src/lib/utils.ts" },
        ],
      });
      return Promise.resolve({});
    });

    const app = createChatApp();
    const res = await app.request("/vfs/src?readdir=true", { headers: { Authorization: BEARER } });
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ name: string; isDirectory: boolean }>;
    const names = body.map((e) => e.name).sort();
    expect(names).toEqual(["app.tsx", "index.ts", "lib"]);
    expect(body.find((e) => e.name === "lib")?.isDirectory).toBe(true);
    expect(body.find((e) => e.name === "index.ts")?.isDirectory).toBe(false);
  });
});

describe("PUT /vfs/:path", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await setupAuth();
    process.env["VFS_TABLE_NAME"] = "test-vfs";
    process.env["VFS_BUCKET_NAME"] = "test-vfs-bucket";
  });

  it("returns 503 when VFS not configured", async () => {
    delete process.env["VFS_TABLE_NAME"];
    delete process.env["VFS_BUCKET_NAME"];
    setupDdbRouter();

    const app = createChatApp();
    const res = await app.request("/vfs/src/index.ts", {
      method: "PUT",
      headers: { Authorization: BEARER, "Content-Type": "text/plain" },
      body: "const x = 1;",
    });
    expect(res.status).toBe(503);
  });

  it("writes to S3 and DDB, returns ok+version", async () => {
    mockS3Send.mockResolvedValue({});
    mockDdbSend.mockImplementation((cmd: { TableName?: string }) => {
      if (cmd.TableName === "test-users") return Promise.resolve({ Item: { activeWorkspaceId: WORKSPACE_ID } });
      if (cmd.TableName === "test-vfs") return Promise.resolve({ Attributes: { version: 1 } });
      return Promise.resolve({});
    });

    const app = createChatApp();
    const res = await app.request("/vfs/src/index.ts", {
      method: "PUT",
      headers: { Authorization: BEARER, "Content-Type": "text/plain" },
      body: "const x = 1;",
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; version: number };
    expect(body.ok).toBe(true);
    expect(body.version).toBe(1);
    expect(mockS3Send).toHaveBeenCalledTimes(1);
  });

  it("returns 409 on concurrent write conflict", async () => {
    const { ConditionalCheckFailedException } = await import("@aws-sdk/client-dynamodb");
    mockS3Send.mockResolvedValue({});
    mockDdbSend.mockImplementation((cmd: { TableName?: string }) => {
      if (cmd.TableName === "test-users") return Promise.resolve({ Item: { activeWorkspaceId: WORKSPACE_ID } });
      if (cmd.TableName === "test-vfs") {
        // First call (UpdateCommand) throws; second call (GetCommand for conflict metadata) succeeds
        if (mockDdbSend.mock.calls.filter((c) => (c[0] as { TableName?: string }).TableName === "test-vfs").length === 1) {
          throw new ConditionalCheckFailedException("conflict");
        }
        return Promise.resolve({ Item: { version: 3 } });
      }
      return Promise.resolve({});
    });

    const app = createChatApp();
    const res = await app.request("/vfs/src/index.ts", {
      method: "PUT",
      headers: {
        Authorization: BEARER,
        "Content-Type": "text/plain",
        "X-Vfs-Expected-Version": "2",
      },
      body: "conflict",
    });
    expect(res.status).toBe(409);
    const body = await res.json() as { ok: boolean; conflict: { serverVersion: number } };
    expect(body.ok).toBe(false);
    expect(body.conflict.serverVersion).toBe(3);
  });
});

describe("DELETE /vfs/:path", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await setupAuth();
    process.env["VFS_TABLE_NAME"] = "test-vfs";
    process.env["VFS_BUCKET_NAME"] = "test-vfs-bucket";
  });

  it("deletes from DDB and S3, returns 204", async () => {
    mockS3Send.mockResolvedValue({});
    mockDdbSend.mockImplementation((cmd: { TableName?: string }) => {
      if (cmd.TableName === "test-users") return Promise.resolve({ Item: { activeWorkspaceId: WORKSPACE_ID } });
      return Promise.resolve({});
    });

    const app = createChatApp();
    const res = await app.request("/vfs/src/old.ts", {
      method: "DELETE",
      headers: { Authorization: BEARER },
    });
    expect(res.status).toBe(204);
    expect(mockS3Send).toHaveBeenCalledTimes(1);
  });
});

describe("POST /vfs/:path?mkdir=true", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await setupAuth();
    setupDdbRouter();
  });

  it("returns 204 (no-op)", async () => {
    const app = createChatApp();
    const res = await app.request("/vfs/src/components?mkdir=true", {
      method: "POST",
      headers: { Authorization: BEARER },
    });
    expect(res.status).toBe(204);
  });

  it("returns 400 for unknown POST operations", async () => {
    const app = createChatApp();
    const res = await app.request("/vfs/src/something", {
      method: "POST",
      headers: { Authorization: BEARER },
    });
    expect(res.status).toBe(400);
  });
});
