import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getGatewaySession,
  evictGatewaySession,
  resetGatewaySessionCache,
  getCachedTools,
  setCachedTools,
  evictCachedTools,
  GatewaySessionError,
} from "../src/gateway-session";
import type { CognitoAccessTokenPayload } from "aws-jwt-verify/jwt-model";

const GATEWAY_URL = "https://gateway.test";
const WORKSPACE_ID = "ws-abc";
const COGNITO_TOKEN = "cognito-access-token";
const USER_SUB = "user-sub-123";
const TOKEN_EXP = Math.floor(Date.now() / 1000) + 3600;

function makeClaims(overrides?: Partial<CognitoAccessTokenPayload>): CognitoAccessTokenPayload {
  return {
    sub: USER_SUB,
    exp: TOKEN_EXP,
    iss: "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_test",
    client_id: "test-client",
    username: "testuser",
    token_use: "access",
    iat: Math.floor(Date.now() / 1000),
    jti: "jti-test",
    auth_time: Math.floor(Date.now() / 1000),
    scope: "",
    version: 2,
    origin_jti: "",
    ...overrides,
  } as unknown as CognitoAccessTokenPayload;
}

beforeEach(() => {
  resetGatewaySessionCache();
  process.env["GATEWAY_URL"] = GATEWAY_URL;
});

afterEach(() => {
  resetGatewaySessionCache();
  vi.restoreAllMocks();
});

describe("getGatewaySession", () => {
  it("calls POST /auth/sessions and returns the cognito token", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ workspace_id: WORKSPACE_ID }), { status: 200 }),
    );

    const session = await getGatewaySession(makeClaims(), WORKSPACE_ID, COGNITO_TOKEN);

    expect(session.token).toBe(COGNITO_TOKEN);
    expect(session.expires_at).toBe(TOKEN_EXP);
    expect(fetchSpy).toHaveBeenCalledWith(
      `${GATEWAY_URL}/auth/sessions`,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: `Bearer ${COGNITO_TOKEN}` }),
        body: JSON.stringify({ workspace_id: WORKSPACE_ID }),
      }),
    );
  });

  it("caches the session and does not re-call the gateway on second call", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ workspace_id: WORKSPACE_ID }), { status: 200 }),
    );

    const s1 = await getGatewaySession(makeClaims(), WORKSPACE_ID, COGNITO_TOKEN);
    const s2 = await getGatewaySession(makeClaims(), WORKSPACE_ID, COGNITO_TOKEN);

    expect(s1.token).toBe(s2.token);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("evicts and re-exchanges after TTL expires", async () => {
    const expiredClaims = makeClaims({ exp: Math.floor(Date.now() / 1000) - 1 });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ workspace_id: WORKSPACE_ID }), { status: 200 }),
    );

    await getGatewaySession(expiredClaims, WORKSPACE_ID, COGNITO_TOKEN);
    await getGatewaySession(expiredClaims, WORKSPACE_ID, COGNITO_TOKEN);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("retries once on 401 and returns session if retry succeeds", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ workspace_id: WORKSPACE_ID }), { status: 200 }),
      );

    const session = await getGatewaySession(makeClaims(), WORKSPACE_ID, COGNITO_TOKEN);
    expect(session.token).toBe(COGNITO_TOKEN);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("throws GatewaySessionError on persistent 401", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Unauthorized", { status: 401 }),
    );

    await expect(
      getGatewaySession(makeClaims(), WORKSPACE_ID, COGNITO_TOKEN),
    ).rejects.toThrow(GatewaySessionError);
  });

  it("throws GatewaySessionError on 403", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Forbidden", { status: 403 }),
    );

    await expect(
      getGatewaySession(makeClaims(), WORKSPACE_ID, COGNITO_TOKEN),
    ).rejects.toThrow(GatewaySessionError);
  });

  it("evictGatewaySession removes the cached entry", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ workspace_id: WORKSPACE_ID }), { status: 200 }),
    );

    await getGatewaySession(makeClaims(), WORKSPACE_ID, COGNITO_TOKEN);
    evictGatewaySession(USER_SUB);
    await getGatewaySession(makeClaims(), WORKSPACE_ID, COGNITO_TOKEN);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("retries once after 200ms on 5xx and returns session if retry succeeds", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("Service Unavailable", { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ workspace_id: WORKSPACE_ID }), { status: 200 }),
      );

    const session = await getGatewaySession(makeClaims(), WORKSPACE_ID, COGNITO_TOKEN);
    expect(session.token).toBe(COGNITO_TOKEN);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("throws GatewaySessionError on persistent 5xx after retry", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Service Unavailable", { status: 503 }),
    );

    await expect(
      getGatewaySession(makeClaims(), WORKSPACE_ID, COGNITO_TOKEN),
    ).rejects.toThrow(GatewaySessionError);
  });

  it("retries once after 200ms on network error and returns session if retry succeeds", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ workspace_id: WORKSPACE_ID }), { status: 200 }),
      );

    const session = await getGatewaySession(makeClaims(), WORKSPACE_ID, COGNITO_TOKEN);
    expect(session.token).toBe(COGNITO_TOKEN);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe("tool cache", () => {
  beforeEach(() => {
    resetGatewaySessionCache();
  });

  afterEach(() => {
    resetGatewaySessionCache();
  });

  it("getCachedTools returns undefined when nothing cached", () => {
    expect(getCachedTools("sub-123")).toBeUndefined();
  });

  it("setCachedTools stores tools and getCachedTools retrieves them", () => {
    const tools = [{ name: "github_repos_list" }];
    setCachedTools("sub-123", tools);
    expect(getCachedTools("sub-123")).toEqual(tools);
  });

  it("evictCachedTools removes tools for a sub", () => {
    setCachedTools("sub-123", [{ name: "github_repos_list" }]);
    evictCachedTools("sub-123");
    expect(getCachedTools("sub-123")).toBeUndefined();
  });

  it("evictGatewaySession also evicts the tool cache for that sub", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ workspace_id: WORKSPACE_ID }), { status: 200 }),
    );
    await getGatewaySession(makeClaims(), WORKSPACE_ID, COGNITO_TOKEN);
    setCachedTools(USER_SUB, [{ name: "tool" }]);
    evictGatewaySession(USER_SUB);
    expect(getCachedTools(USER_SUB)).toBeUndefined();
  });

  it("resetGatewaySessionCache also clears the tool cache", () => {
    setCachedTools("sub-a", [{ name: "tool" }]);
    resetGatewaySessionCache();
    expect(getCachedTools("sub-a")).toBeUndefined();
  });
});
