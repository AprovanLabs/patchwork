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
  BatchGetCommand: vi.fn((input) => input),
}));

const { workspacesRoute } = await import("../../src/routes/workspaces");
const { resetMembershipCache } = await import("../../src/middleware/workspace");
const { resetSessionCache } = await import("../../src/session");

const MEMBERSHIPS_TABLE = "test-memberships";
const WORKSPACE_TABLE = "test-workspaces";
const SESSIONS_TABLE = "test-user-sessions";

type MockCommand = { TableName?: string; RequestItems?: Record<string, unknown> };

const fakeClaims = { sub: "user-ws-test" } as unknown as CognitoAccessTokenPayload;

function buildApp() {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use("/*", async (c, next) => {
    c.set("claims", fakeClaims);
    await next();
  });
  app.route("/workspaces", workspacesRoute);
  return app;
}

describe("GET /workspaces", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMembershipCache();
    resetSessionCache();
    process.env["MEMBERSHIPS_TABLE_NAME"] = MEMBERSHIPS_TABLE;
    process.env["WORKSPACE_TABLE_NAME"] = WORKSPACE_TABLE;
    process.env["USER_SESSIONS_TABLE_NAME"] = SESSIONS_TABLE;
    process.env["AWS_REGION"] = "us-east-1";
  });

  it("returns workspace list with active flag", async () => {
    mockSend.mockImplementation((cmd: MockCommand) => {
      if (cmd.TableName === SESSIONS_TABLE) {
        return Promise.resolve({ Item: { activeWorkspaceId: "ws-b" } });
      }
      if (cmd.TableName === MEMBERSHIPS_TABLE) {
        return Promise.resolve({ Items: [{ workspaceId: "ws-a" }, { workspaceId: "ws-b" }] });
      }
      if (cmd.RequestItems?.[WORKSPACE_TABLE]) {
        return Promise.resolve({
          Responses: {
            [WORKSPACE_TABLE]: [
              { workspaceId: "ws-a", name: "Alpha", plan: "free" },
              { workspaceId: "ws-b", name: "Beta", plan: "pro" },
            ],
          },
        });
      }
      return Promise.resolve({});
    });

    const app = buildApp();
    const res = await app.request("/workspaces");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.activeWorkspaceId).toBe("ws-b");
    const beta = body.workspaces.find((w: { workspaceId: string }) => w.workspaceId === "ws-b");
    expect(beta?.active).toBe(true);
  });

  it("falls back to first membership when no session preference", async () => {
    mockSend.mockImplementation((cmd: MockCommand) => {
      if (cmd.TableName === SESSIONS_TABLE) {
        return Promise.resolve({ Item: undefined });
      }
      if (cmd.TableName === MEMBERSHIPS_TABLE) {
        return Promise.resolve({ Items: [{ workspaceId: "ws-a" }] });
      }
      if (cmd.RequestItems?.[WORKSPACE_TABLE]) {
        return Promise.resolve({
          Responses: { [WORKSPACE_TABLE]: [{ workspaceId: "ws-a", name: "Alpha", plan: "free" }] },
        });
      }
      return Promise.resolve({});
    });

    const app = buildApp();
    const res = await app.request("/workspaces");
    const body = await res.json();
    expect(body.activeWorkspaceId).toBe("ws-a");
    expect(body.workspaces[0].active).toBe(true);
  });
});

describe("PUT /workspaces/active", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMembershipCache();
    resetSessionCache();
    process.env["MEMBERSHIPS_TABLE_NAME"] = MEMBERSHIPS_TABLE;
    process.env["WORKSPACE_TABLE_NAME"] = WORKSPACE_TABLE;
    process.env["USER_SESSIONS_TABLE_NAME"] = SESSIONS_TABLE;
    process.env["AWS_REGION"] = "us-east-1";
  });

  it("sets active workspace and returns it", async () => {
    mockSend.mockImplementation((cmd: MockCommand) => {
      if (cmd.TableName === MEMBERSHIPS_TABLE) {
        return Promise.resolve({ Items: [{ workspaceId: "ws-a" }, { workspaceId: "ws-b" }] });
      }
      return Promise.resolve({});
    });

    const app = buildApp();
    const res = await app.request("/workspaces/active", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: "ws-b" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.activeWorkspaceId).toBe("ws-b");
  });

  it("returns 403 when workspace is not in user memberships", async () => {
    mockSend.mockImplementation((cmd: MockCommand) => {
      if (cmd.TableName === MEMBERSHIPS_TABLE) {
        return Promise.resolve({ Items: [{ workspaceId: "ws-a" }] });
      }
      return Promise.resolve({});
    });

    const app = buildApp();
    const res = await app.request("/workspaces/active", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: "ws-other" }),
    });
    expect(res.status).toBe(403);
  });

  it("returns 400 for invalid request body", async () => {
    const app = buildApp();
    const res = await app.request("/workspaces/active", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: "" }),
    });
    expect(res.status).toBe(400);
  });
});
