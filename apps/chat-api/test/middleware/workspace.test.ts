import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type { AppVariables } from "../../src/types";
import type { CognitoAccessTokenPayload } from "aws-jwt-verify/jwt-model";

// Mock the DDB client before importing the middleware
vi.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: vi.fn(() => ({})),
}));

const mockSend = vi.fn();
vi.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: {
    from: vi.fn(() => ({ send: mockSend })),
  },
  QueryCommand: vi.fn((input) => input),
}));

const { workspaceMiddleware, resolveWorkspaceId } = await import(
  "../../src/middleware/workspace"
);

const fakeClaims = {
  sub: "user-sub-123",
} as unknown as CognitoAccessTokenPayload;

function buildApp() {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use("/protected", async (c, next) => {
    c.set("claims", fakeClaims);
    await next();
  });
  app.use("/protected", workspaceMiddleware);
  app.get("/protected", (c) =>
    c.json({ workspaceId: c.get("workspaceId") }),
  );
  return app;
}

describe("workspaceMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env["MEMBERSHIPS_TABLE_NAME"] = "gateway-prd-use1-memberships";
    process.env["AWS_REGION"] = "us-east-1";
    // Clear the module-level cache between tests by resetting the module state.
    // resolveWorkspaceId memoizes per sub; tests use unique subs or clear cache.
  });

  it("resolves workspaceId from DDB and sets it on context", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [{ workspaceId: "ws-abc", userSub: "user-sub-456" }],
    });

    const app = new Hono<{ Variables: AppVariables }>();
    const localClaims = { sub: "user-sub-456" } as unknown as CognitoAccessTokenPayload;
    app.use("/protected", async (c, next) => {
      c.set("claims", localClaims);
      await next();
    });
    app.use("/protected", workspaceMiddleware);
    app.get("/protected", (c) => c.json({ workspaceId: c.get("workspaceId") }));

    const res = await app.request("/protected");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ workspaceId: "ws-abc" });
  });

  it("returns 403 when no membership exists", async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const app = new Hono<{ Variables: AppVariables }>();
    const localClaims = {
      sub: "user-no-ws",
    } as unknown as CognitoAccessTokenPayload;
    app.use("/protected", async (c, next) => {
      c.set("claims", localClaims);
      await next();
    });
    app.use("/protected", workspaceMiddleware);
    app.get("/protected", (c) => c.json({ workspaceId: c.get("workspaceId") }));

    const res = await app.request("/protected");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toMatchObject({ error: "No workspace membership" });
  });

  it("uses cache on subsequent calls for the same sub", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [{ workspaceId: "ws-cached", userSub: "user-cached" }],
    });

    // First call — hits DDB
    await resolveWorkspaceId("user-cached");
    // Second call — should use cache
    await resolveWorkspaceId("user-cached");

    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});
