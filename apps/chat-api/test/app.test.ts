import { describe, it, expect, vi, beforeAll } from "vitest";
import { createChatApp } from "../src/app";

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

vi.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: {
    from: vi.fn(() => ({ send: vi.fn() })),
  },
  QueryCommand: vi.fn((input) => input),
  GetCommand: vi.fn((input) => input),
  PutCommand: vi.fn((input) => input),
  BatchGetCommand: vi.fn((input) => input),
}));

beforeAll(() => {
  process.env["COGNITO_USER_POOL_ID"] = "us-east-1_test";
  process.env["COGNITO_CLIENT_ID"] = "test-client-id";
  process.env["AWS_REGION"] = "us-east-1";
  process.env["WORKSPACE_TABLE_NAME"] = "test-workspaces";
  process.env["MEMBERSHIPS_TABLE_NAME"] = "test-memberships";
  process.env["USER_SESSIONS_TABLE_NAME"] = "test-user-sessions";
});

describe("chat app", () => {
  const app = createChatApp();

  it("GET /health returns ok without auth", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "ok" });
  });

  it("GET /api/* returns 401 without Authorization header", async () => {
    const res = await app.request("/api/chat");
    expect(res.status).toBe(401);
  });

  it("GET /api/* returns 401 with invalid Bearer token", async () => {
    const { CognitoJwtVerifier } = await import("aws-jwt-verify");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (CognitoJwtVerifier.create({} as any) as any).verify.mockRejectedValueOnce(
      new Error("invalid token"),
    );
    const res = await app.request("/api/chat", {
      headers: { Authorization: "Bearer bad.token" },
    });
    expect(res.status).toBe(401);
  });
});
