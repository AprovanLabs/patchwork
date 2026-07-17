/**
 * Fetch wrapper for calls to the Aprovan gateway.
 *
 * The production gateway sits behind CloudFront with an Origin Access Control
 * that SigV4-signs every origin request to the IAM-protected Lambda Function
 * URL. Two transport consequences for the browser:
 *
 * 1. The standard `Authorization` header is overwritten by CloudFront's own
 *    signature, so the Cognito token rides in `X-Aprovan-Authorization`
 *    instead (the gateway reads it first, falling back to `Authorization`
 *    for direct/dev access).
 * 2. CloudFront does not include request bodies in its signature: for any
 *    request with a payload the client must send `x-amz-content-sha256`
 *    (hex SHA-256 of the body) or Lambda rejects the origin request with
 *    "The request signature we calculated does not match…".
 */

import { getAccessTokenSync } from "./auth";

/** Header carrying the Cognito bearer token (see module docs). */
export const GATEWAY_AUTH_HEADER = "X-Aprovan-Authorization";

/** Hex-encoded SHA-256 of a request payload. */
export async function sha256Hex(payload: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(payload),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * `fetch` with gateway auth + CloudFront OAC payload hash applied. Accepts the
 * same arguments as `fetch`; string bodies are hashed into
 * `x-amz-content-sha256` automatically.
 */
export const gatewayFetch: typeof fetch = async (input, init) => {
  const headers = new Headers(init?.headers);

  const token = getAccessTokenSync();
  if (token && !headers.has(GATEWAY_AUTH_HEADER)) {
    headers.set(GATEWAY_AUTH_HEADER, `Bearer ${token}`);
  }

  const body = init?.body;
  if (typeof body === "string" && !headers.has("x-amz-content-sha256")) {
    headers.set("x-amz-content-sha256", await sha256Hex(body));
  }

  return fetch(input, { ...init, headers });
};
