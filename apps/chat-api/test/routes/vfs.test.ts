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
}));

const mockDdbSend = vi.fn();
vi.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: {
    from: vi.fn(() => ({ send: mockDdbSend })),
  },
  UpdateCommand: vi.fn((input) => input),
  GetCommand: vi.fn((input) => input),
  QueryCommand: vi.fn((input) => input),
}));

beforeAll(() => {
  process.env["COGNITO_USER_POOL_ID"] = "us-east-1_test";
  process.env["COGNITO_CLIENT_ID"] = "test-client-id";
  process.env["AWS_REGION"] = "us-east-1";
  process.env["WORKSPACE_TABLE_NAME"] = "test-workspaces";
  process.env["MEMBERSHIPS_TABLE_NAME"] = "test-memberships";
  process.env["USERS_TABLE_NAME"] = "test-users";
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
