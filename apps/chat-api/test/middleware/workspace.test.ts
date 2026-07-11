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
  GetCommand: vi.fn((input) => input),
}));

const { workspaceMiddleware, resolveWorkspaceId, evictWorkspaceCache } = await import(
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
    process.env["USERS_TABLE_NAME"] = "gateway-prd-use1-users";
    process.env["AWS_REGION"] = "us-east-1";
    // Clear module-level cache between tests
    evictWorkspaceCache("user-sub-123");
    evictWorkspaceCache("user-sub-456");
    evictWorkspaceCache("user-no-ws");
    evictWorkspaceCache("user-cached");
    evictWorkspaceCache("user-users-table");
    evictWorkspaceCache("user-fallback");
  });

  it("uses activeWorkspaceId from Users table when present", async () => {
    // Users table returns activeWorkspaceId — no Memberships query needed
    mockSend.mockResolvedValueOnce({
      Item: { sub: "user-users-table", activeWorkspaceId: "ws-from-users" },
    });

    const app = new Hono<{ Variables: AppVariables }>();
    const localClaims = { sub: "user-users-table" } as unknown as CognitoAccessTokenPayload;
    app.use("/protected", async (c, next) => {
      c.set("claims", localClaims);
      await next();
    });
    app.use("/protected", workspaceMiddleware);
    app.get("/protected", (c) => c.json({ workspaceId: c.get("workspaceId") }));

    const res = await app.request("/protected");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ workspaceId: "ws-from-users" });
    // Only one DDB call (Users Get), no Memberships query
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("falls back to Memberships when Users table has no activeWorkspaceId", async () => {
    // Users Get returns no item; Memberships query returns ws-from-memberships
    mockSend
      .mockResolvedValueOnce({}) // Users GetCommand → no item
      .mockResolvedValueOnce({
        Items: [{ workspaceId: "ws-from-memberships", userSub: "user-fallback" }],
      }); // Memberships QueryCommand

    const app = new Hono<{ Variables: AppVariables }>();
    const localClaims = { sub: "user-fallback" } as unknown as CognitoAccessTokenPayload;
    app.use("/protected", async (c, next) => {
      c.set("claims", localClaims);
      await next();
    });
    app.use("/protected", workspaceMiddleware);
    app.get("/protected", (c) => c.json({ workspaceId: c.get("workspaceId") }));

    const res = await app.request("/protected");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ workspaceId: "ws-from-memberships" });
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it("resolves workspaceId from DDB and sets it on context", async () => {
    mockSend
      .mockResolvedValueOnce({}) // Users GetCommand → no item
      .mockResolvedValueOnce({
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

  it("returns 403 when no membership exists and Users table has no activeWorkspaceId", async () => {
    mockSend
      .mockResolvedValueOnce({}) // Users GetCommand → no item
      .mockResolvedValueOnce({ Items: [] }); // Memberships QueryCommand → empty

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
      Item: { activeWorkspaceId: "ws-cached" },
    });

    // First call — hits DDB
    await resolveWorkspaceId("user-cached");
    // Second call — should use cache
    await resolveWorkspaceId("user-cached");

    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("evictWorkspaceCache clears the cache so next call re-fetches", async () => {
    mockSend
      .mockResolvedValueOnce({ Item: { activeWorkspaceId: "ws-v1" } })
      .mockResolvedValueOnce({ Item: { activeWorkspaceId: "ws-v2" } });

    await resolveWorkspaceId("user-cached");
    evictWorkspaceCache("user-cached");
    const result = await resolveWorkspaceId("user-cached");

    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(result).toBe("ws-v2");
  });
});
