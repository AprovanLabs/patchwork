import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { authMiddleware } from "../../src/middleware/auth";
import type { AppVariables } from "../../src/types";
import type { CognitoAccessTokenPayload } from "aws-jwt-verify/jwt-model";

// Mock aws-jwt-verify at the module level
vi.mock("aws-jwt-verify", () => {
  const verify = vi.fn();
  return {
    CognitoJwtVerifier: {
      create: vi.fn(() => ({ verify })),
    },
  };
});

// Access the mocked verify function
const { CognitoJwtVerifier } = await import("aws-jwt-verify");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockVerify = (CognitoJwtVerifier.create({} as any) as any).verify as ReturnType<typeof vi.fn>;

function buildApp() {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use("/protected", authMiddleware);
  app.get("/protected", (c) => c.json({ sub: c.get("claims").sub }));
  return app;
}

const fakeClaims = {
  sub: "user-sub-123",
  token_use: "access",
  iss: "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_abc",
  aud: "client-id",
  exp: Math.floor(Date.now() / 1000) + 3600,
  iat: Math.floor(Date.now() / 1000),
} as unknown as CognitoAccessTokenPayload;

describe("authMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env["COGNITO_USER_POOL_ID"] = "us-east-1_abc";
    process.env["COGNITO_CLIENT_ID"] = "client-id";
  });

  it("passes with a valid Bearer token and sets claims", async () => {
    mockVerify.mockResolvedValueOnce(fakeClaims);
    const app = buildApp();
    const res = await app.request("/protected", {
      headers: { Authorization: "Bearer valid.token.here" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ sub: "user-sub-123" });
  });

  it("returns 401 when Authorization header is missing", async () => {
    const app = buildApp();
    const res = await app.request("/protected");
    expect(res.status).toBe(401);
  });

  it("returns 401 when Authorization header is not Bearer", async () => {
    const app = buildApp();
    const res = await app.request("/protected", {
      headers: { Authorization: "Basic dXNlcjpwYXNz" },
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 for an expired token", async () => {
    mockVerify.mockRejectedValueOnce(new Error("Token expired"));
    const app = buildApp();
    const res = await app.request("/protected", {
      headers: { Authorization: "Bearer expired.token.here" },
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 for wrong audience", async () => {
    mockVerify.mockRejectedValueOnce(new Error("Token has expired or audience mismatch"));
    const app = buildApp();
    const res = await app.request("/protected", {
      headers: { Authorization: "Bearer wrong.audience.token" },
    });
    expect(res.status).toBe(401);
  });
});
