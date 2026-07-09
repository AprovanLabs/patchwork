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

describe("POST /api/proxy/:ns/:proc", () => {
  it("forwards body and session token to the gateway and returns the response", async () => {
    const app = createChatApp();
    const expectedResult = { data: [{ id: "repo-1" }], meta: { requestId: "r1" } };

    mockFetch
      // POST /auth/sessions
      .mockResolvedValueOnce(new Response(JSON.stringify({ workspace_id: "ws-test" }), { status: 200 }))
      // POST /tools/github/repos.list
      .mockResolvedValueOnce(new Response(JSON.stringify(expectedResult), { status: 200 }));

    const res = await app.request("/api/proxy/github/repos.list", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer cognito-token",
      },
      body: JSON.stringify({ per_page: 10 }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(expectedResult);

    // Verify the gateway call used the session bearer and forwarded the body
    const toolCall = mockFetch.mock.calls.find(
      (c) => typeof c[0] === "string" && (c[0] as string).includes("/tools/github/repos.list"),
    );
    expect(toolCall).toBeDefined();
    const toolCallOptions = toolCall![1] as RequestInit;
    expect((toolCallOptions.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer cognito-token",
    );
    expect(JSON.parse(toolCallOptions.body as string)).toEqual({ per_page: 10 });
  });

  it("returns 401 without Authorization header", async () => {
    const app = createChatApp();
    const res = await app.request("/api/proxy/github/repos.list", { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("forwards the gateway error status when gateway returns non-2xx", async () => {
    const app = createChatApp();

    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ workspace_id: "ws-test" }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
      );

    const res = await app.request("/api/proxy/github/repos.list", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer cognito-token",
      },
    });

    expect(res.status).toBe(403);
  });
});
