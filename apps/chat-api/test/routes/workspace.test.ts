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

const USER_SUB = "test-user-sub";
const BEARER = "Bearer valid.token.here";

async function makeVerify(sub: string) {
  const { CognitoJwtVerifier } = await import("aws-jwt-verify");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (CognitoJwtVerifier.create({} as any) as any).verify.mockResolvedValue({
    sub,
  } as unknown as CognitoAccessTokenPayload);
}

describe("POST /api/workspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 without Authorization header", async () => {
    const app = createChatApp();
    const res = await app.request("/api/workspace", { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("switches workspace and evicts cache", async () => {
    await makeVerify(USER_SUB);
    mockDdbSend.mockResolvedValueOnce({}); // UpdateCommand succeeds

    const app = createChatApp();
    const res = await app.request("/api/workspace", {
      method: "POST",
      headers: {
        Authorization: BEARER,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ workspaceId: "ws-new" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { activeWorkspaceId: string };
    expect(body.activeWorkspaceId).toBe("ws-new");

    // UpdateCommand should have been called with USERS_TABLE_NAME
    expect(mockDdbSend).toHaveBeenCalledTimes(1);
    const call = mockDdbSend.mock.calls[0]![0] as {
      TableName?: string;
      Key?: Record<string, unknown>;
      ExpressionAttributeValues?: Record<string, unknown>;
    };
    expect(call.TableName).toBe("test-users");
    expect(call.Key?.["sub"]).toBe(USER_SUB);
    expect(call.ExpressionAttributeValues?.[":ws"]).toBe("ws-new");
  });

  it("returns 400 when workspaceId is missing", async () => {
    await makeVerify(USER_SUB);

    const app = createChatApp();
    const res = await app.request("/api/workspace", {
      method: "POST",
      headers: {
        Authorization: BEARER,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/workspaceId/);
  });
});
