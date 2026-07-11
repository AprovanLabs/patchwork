import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type { AppVariables } from "../../src/types";
import type { CognitoAccessTokenPayload } from "aws-jwt-verify/jwt-model";

vi.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: vi.fn(() => ({})),
}));

const mockSend = vi.fn();
vi.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: {
    from: vi.fn(() => ({ send: mockSend })),
  },
  QueryCommand: vi.fn((input) => input),
  GetCommand: vi.fn((input) => input),
  PutCommand: vi.fn((input) => input),
}));

const {
  workspaceMiddleware,
  listWorkspaceMemberships,
  resetMembershipCache,
} = await import("../../src/middleware/workspace");
const { resetSessionCache } = await import("../../src/session");

const MEMBERSHIPS_TABLE = "gateway-prd-use1-memberships";
const SESSIONS_TABLE = "test-user-sessions";

type MockCommand = { TableName?: string };

function buildApp(userSub: string) {
  const fakeClaims = { sub: userSub } as unknown as CognitoAccessTokenPayload;
  const app = new Hono<{ Variables: AppVariables }>();
  app.use("/protected", async (c, next) => {
    c.set("claims", fakeClaims);
    await next();
  });
  app.use("/protected", workspaceMiddleware);
  app.get("/protected", (c) => c.json({ workspaceId: c.get("workspaceId") }));
  return app;
}

describe("workspaceMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMembershipCache();
    resetSessionCache();
    process.env["MEMBERSHIPS_TABLE_NAME"] = MEMBERSHIPS_TABLE;
    process.env["USER_SESSIONS_TABLE_NAME"] = SESSIONS_TABLE;
    process.env["AWS_REGION"] = "us-east-1";
  });

  it("uses session activeWorkspaceId when membership is valid", async () => {
    mockSend.mockImplementation((cmd: MockCommand) => {
      if (cmd.TableName === SESSIONS_TABLE) {
        return Promise.resolve({ Item: { activeWorkspaceId: "ws-b" } });
      }
      return Promise.resolve({ Items: [{ workspaceId: "ws-a" }, { workspaceId: "ws-b" }] });
    });

    const app = buildApp("user-session");
    const res = await app.request("/protected");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.workspaceId).toBe("ws-b");
  });

  it("falls back to first membership when no session preference exists", async () => {
    mockSend.mockImplementation((cmd: MockCommand) => {
      if (cmd.TableName === SESSIONS_TABLE) {
        return Promise.resolve({ Item: undefined });
      }
      return Promise.resolve({ Items: [{ workspaceId: "ws-first" }] });
    });

    const app = buildApp("user-no-session");
    const res = await app.request("/protected");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.workspaceId).toBe("ws-first");
  });

  it("falls back to first membership when session workspace is not in memberships", async () => {
    mockSend.mockImplementation((cmd: MockCommand) => {
      if (cmd.TableName === SESSIONS_TABLE) {
        return Promise.resolve({ Item: { activeWorkspaceId: "ws-stale" } });
      }
      return Promise.resolve({ Items: [{ workspaceId: "ws-a" }] });
    });

    const app = buildApp("user-stale");
    const res = await app.request("/protected");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.workspaceId).toBe("ws-a");
  });

  it("returns 403 when user has no workspace memberships", async () => {
    mockSend.mockImplementation((cmd: MockCommand) => {
      if (cmd.TableName === SESSIONS_TABLE) {
        return Promise.resolve({ Item: undefined });
      }
      return Promise.resolve({ Items: [] });
    });

    const app = buildApp("user-no-ws");
    const res = await app.request("/protected");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toMatchObject({ error: "No workspace membership" });
  });

  it("uses membership cache on subsequent calls for the same sub", async () => {
    mockSend.mockResolvedValue({ Items: [{ workspaceId: "ws-cached" }] });

    await listWorkspaceMemberships("user-cached-q");
    await listWorkspaceMemberships("user-cached-q");
    // Only one DDB send for memberships (cache hit on second call)
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});
