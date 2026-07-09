/**
 * POST /api/proxy/:ns/:proc
 *
 * Forwards the request body to `POST <gateway>/tools/:ns/:proc` using the
 * caller's gateway session bearer. This keeps tool invocations server-side
 * (credentials never reach the browser).
 */

import { Hono } from "hono";
import { evictGatewaySession, GatewaySessionError, getGatewaySession } from "../gateway-session.js";
import type { AppVariables } from "../types.js";

export const proxy = new Hono<{ Variables: AppVariables }>();

proxy.post("/:ns/:proc{.*}", async (c) => {
  const claims = c.get("claims");
  const workspaceId = c.get("workspaceId");

  const ns = c.req.param("ns");
  const proc = c.req.param("proc");

  const authHeader = c.req.header("Authorization")!;
  const cognitoToken = authHeader.slice("Bearer ".length);

  let sessionToken: string;
  try {
    const session = await getGatewaySession(claims, workspaceId, cognitoToken);
    sessionToken = session.token;
  } catch (err) {
    if (err instanceof GatewaySessionError && err.status === 401) {
      return c.json({ error: "Gateway session setup failed" }, 401);
    }
    return c.json({ error: "Failed to connect to gateway" }, 502);
  }

  let body: unknown = {};
  try {
    body = await c.req.json();
  } catch {
    // empty body is fine
  }

  const gatewayUrl = process.env["GATEWAY_URL"]!.replace(/\/$/, "");
  const res = await fetch(`${gatewayUrl}/tools/${ns}/${proc}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sessionToken}`,
    },
    body: JSON.stringify(body),
  });

  if (res.status === 401) {
    evictGatewaySession(claims.sub);
    return c.json({ error: "Gateway authentication failed" }, 502);
  }

  const responseData = await res.json();
  return c.json(responseData, res.status as 200);
});
