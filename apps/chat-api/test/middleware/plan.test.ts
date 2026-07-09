import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type { AppVariables, WorkspaceItem } from "../../src/types";
import type { CognitoAccessTokenPayload } from "aws-jwt-verify/jwt-model";

vi.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: vi.fn(() => ({})),
}));

const mockSend = vi.fn();
vi.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: {
    from: vi.fn(() => ({ send: mockSend })),
  },
  GetCommand: vi.fn((input) => input),
}));

const { planMiddleware, getWorkspace } = await import("../../src/middleware/plan");

const freeWorkspace: WorkspaceItem = {
  workspaceId: "ws-plan-test",
  name: "Test Workspace",
  plan: "free",
  limits: {
    dailyChatCap: 50,
    maxModels: ["openrouter/auto"],
    maxToolSteps: 5,
    maxTokensPerRequest: 4096,
  },
  features: {
    advancedTools: false,
    customPrompts: false,
  },
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-01T00:00:00Z",
};

function buildApp(workspaceId: string) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use("/protected", async (c, next) => {
    c.set("claims", { sub: "user-sub" } as unknown as CognitoAccessTokenPayload);
    c.set("workspaceId", workspaceId);
    await next();
  });
  app.use("/protected", planMiddleware);
  app.get("/protected", (c) =>
    c.json({ plan: c.get("workspace").plan }),
  );
  return app;
}

describe("planMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env["WORKSPACE_TABLE_NAME"] = "gateway-prd-use1-workspaces";
    process.env["AWS_REGION"] = "us-east-1";
  });

  it("passes and sets workspace for a valid free plan", async () => {
    mockSend.mockResolvedValueOnce({ Item: { ...freeWorkspace, workspaceId: "ws-free" } });
    const app = buildApp("ws-free");
    const res = await app.request("/protected");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ plan: "free" });
  });

  it("returns 404 when workspace is not found", async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });
    const app = buildApp("ws-missing");
    const res = await app.request("/protected");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toMatchObject({ error: "Workspace not found" });
  });

  it("returns 402 when chat feature is explicitly disabled", async () => {
    const restrictedWorkspace = {
      ...freeWorkspace,
      workspaceId: "ws-restricted",
      features: { ...freeWorkspace.features, chat: false },
    };
    mockSend.mockResolvedValueOnce({ Item: restrictedWorkspace });
    const app = buildApp("ws-restricted");
    const res = await app.request("/protected");
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body).toMatchObject({ error: expect.stringContaining("plan") });
  });

  it("uses cache on subsequent calls for the same workspaceId", async () => {
    mockSend.mockResolvedValueOnce({
      Item: { ...freeWorkspace, workspaceId: "ws-cache-test" },
    });
    await getWorkspace("ws-cache-test");
    await getWorkspace("ws-cache-test");
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});
