/**
 * Gateway session client.
 *
 * The registry gateway authenticates every request with the caller's Cognito
 * access token and requires the active workspace to be persisted in DDB via
 * `POST /auth/sessions` before other endpoints will accept requests.
 *
 * GatewaySessionClient handles that one-time setup per user and returns the
 * Cognito token itself as the bearer to use on subsequent gateway calls. The
 * result is cached in-memory per user sub for the remaining lifetime of the
 * Cognito token.
 */

import type { CognitoAccessTokenPayload } from "aws-jwt-verify/jwt-model";

interface SessionEntry {
  /** The Cognito access token to use as bearer for gateway calls. */
  token: string;
  /** Unix seconds — mirrors the Cognito token's `exp` claim. */
  expires_at: number;
}

const sessionCache = new Map<string, SessionEntry>();

function gatewayUrl(): string {
  const url = process.env["GATEWAY_URL"];
  if (!url) throw new Error("GATEWAY_URL is not set");
  return url.replace(/\/$/, "");
}

/**
 * Establish (or reuse) a gateway session for the caller.
 *
 * 1. Returns the cached entry if still valid.
 * 2. Calls `POST /auth/sessions` on the gateway to register the active
 *    workspace for this user.
 * 3. Returns the Cognito token as the bearer — the gateway uses it directly.
 * 4. On 401, evicts the cache and retries once.
 */
export async function getGatewaySession(
  claims: CognitoAccessTokenPayload,
  workspaceId: string,
  cognitoToken: string,
): Promise<SessionEntry> {
  const sub = claims.sub;
  const now = Math.floor(Date.now() / 1000);

  const cached = sessionCache.get(sub);
  if (cached && cached.expires_at > now + 60) {
    return cached;
  }

  const entry = await exchangeSession(cognitoToken, workspaceId, claims.exp as number);
  sessionCache.set(sub, entry);
  return entry;
}

async function exchangeSession(
  cognitoToken: string,
  workspaceId: string,
  exp: number,
): Promise<SessionEntry> {
  const res = await callAuthSessions(cognitoToken, workspaceId);

  if (res.status === 401) {
    // Retry once — token may have just been refreshed by the caller.
    const retryRes = await callAuthSessions(cognitoToken, workspaceId);
    if (!retryRes.ok) {
      throw new GatewaySessionError(retryRes.status, await retryRes.text());
    }
    return { token: cognitoToken, expires_at: exp };
  }

  if (!res.ok) {
    throw new GatewaySessionError(res.status, await res.text());
  }

  return { token: cognitoToken, expires_at: exp };
}

async function callAuthSessions(
  cognitoToken: string,
  workspaceId: string,
): Promise<Response> {
  return fetch(`${gatewayUrl()}/auth/sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cognitoToken}`,
    },
    body: JSON.stringify({ workspace_id: workspaceId }),
  });
}

export function evictGatewaySession(sub: string): void {
  sessionCache.delete(sub);
}

export function resetGatewaySessionCache(): void {
  sessionCache.clear();
}

export class GatewaySessionError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(`Gateway session exchange failed (${status}): ${message}`);
    this.name = "GatewaySessionError";
  }
}
