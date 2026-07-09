import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { createChatApp } from "../../src/app";
import { resetGatewaySessionCache } from "../../src/gateway-session";

// ── Global fetch stub ─────────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ── Middleware mocks ──────────────────────────────────────────────────────────

vi.mock("aws-jwt-verify", () => {
  const verify = vi.fn().mockResolvedValue({
    sub: "user-123",
    exp: Math.floor(Date.now() / 1000) + 3600,
    token_use: "access",
  });
  return { CognitoJwtVerifier: { create: vi.fn(() => ({ verify })) } };
});

vi.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: vi.fn(() => ({})),
}));

const mockSend = vi.fn();
vi.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: { from: vi.fn(() => ({ send: mockSend })) },
  QueryCommand: vi.fn((i) => i),
  GetCommand: vi.fn((i) => i),
}));

// ── Environment + DDB setup ───────────────────────────────────────────────────

beforeAll(() => {
  process.env["COGNITO_USER_POOL_ID"] = "us-east-1_test";
  process.env["COGNITO_CLIENT_ID"] = "test-client-id";
  process.env["AWS_REGION"] = "us-east-1";
  process.env["WORKSPACE_TABLE_NAME"] = "test-workspaces";
  process.env["MEMBERSHIPS_TABLE_NAME"] = "test-memberships";
  process.env["GATEWAY_URL"] = "https://gateway.test";
  process.env["OPENROUTER_API_KEY"] = "test-key";
});

beforeEach(() => {
  mockFetch.mockReset();
  resetGatewaySessionCache();

  mockSend.mockImplementation((cmd: { IndexName?: string }) => {
    if (cmd.IndexName === "ByUserSub") {
      return Promise.resolve({ Items: [{ workspaceId: "ws-test" }] });
    }
    return Promise.resolve({
      Item: {
        workspaceId: "ws-test",
        plan: "pro",
        limits: {},
        features: {},
        createdAt: "",
        updatedAt: "",
      },
    });
  });
});

afterEach(() => {
  vi.clearAllMocks();
  resetGatewaySessionCache();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/services", () => {
  it("returns namespaces and services from the gateway", async () => {
    const app = createChatApp();

    mockFetch
      // POST /auth/sessions
      .mockResolvedValueOnce(new Response(JSON.stringify({ workspace_id: "ws-test" }), { status: 200 }))
      // GET /tools
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            tools: [
              {
                provider: "github",
                name: "github.repos_list",
                operation: "repos_list",
                description: "List repos",
                inputSchema: { type: "object", properties: { per_page: { type: "number" } } },
              },
            ],
            workspace_id: "ws-test",
          }),
          { status: 200 },
        ),
      );

    const res = await app.request("/api/services", {
      headers: { Authorization: "Bearer test-token" },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { namespaces: string[]; services: unknown[] };
    expect(body.namespaces).toContain("github");
    expect(body.services).toHaveLength(1);
    expect((body.services[0] as { namespace: string }).namespace).toBe("github");
  });

  it("returns 502 when gateway tools fetch fails", async () => {
    const app = createChatApp();

    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ workspace_id: "ws-test" }), { status: 200 }))
      .mockResolvedValueOnce(new Response("Internal error", { status: 500 }));

    const res = await app.request("/api/services", {
      headers: { Authorization: "Bearer test-token" },
    });

    expect(res.status).toBe(502);
  });

  it("returns 401 without Authorization header", async () => {
    const app = createChatApp();
    const res = await app.request("/api/services");
    expect(res.status).toBe(401);
  });
});
