/**
 * GET /api/services
 *
 * Fetches the gateway's tool list and returns a service summary the frontend
 * uses to populate namespace suggestions and the ServicesInspector panel.
 *
 * Response shape:
 *   { namespaces: string[], services: ServiceInfo[] }
 *
 * where ServiceInfo matches the frontend's expected `ServiceInfo` type:
 *   { namespace: string, name: string, description?: string }
 */

import { Hono } from "hono";
import { evictGatewaySession, GatewaySessionError, getGatewaySession } from "../gateway-session.js";
import type { AppVariables } from "../types.js";

export interface ServiceInfo {
  namespace: string;
  name: string;
  procedure: string;
  description: string;
  parameters?: Record<string, unknown>;
}

export const services = new Hono<{ Variables: AppVariables }>();

services.get("/", async (c) => {
  const claims = c.get("claims");
  const workspaceId = c.get("workspaceId");

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

  const gatewayUrl = process.env["GATEWAY_URL"]!.replace(/\/$/, "");
  const res = await fetch(`${gatewayUrl}/tools`, {
    headers: { Authorization: `Bearer ${sessionToken}` },
  });

  if (res.status === 401) {
    evictGatewaySession(claims.sub);
    return c.json({ error: "Gateway authentication failed" }, 502);
  }

  if (!res.ok) {
    return c.json({ error: "Gateway tools fetch failed" }, 502);
  }

  const data = await res.json() as {
    tools: Array<{
      provider: string;
      name: string;
      operation: string;
      description?: string;
      inputSchema?: unknown;
    }>;
    workspace_id: string;
  };

  const serviceList: ServiceInfo[] = data.tools.map((t) => ({
    namespace: t.provider,
    name: t.name,
    procedure: t.operation,
    description: t.description ?? "",
    parameters: t.inputSchema as Record<string, unknown> | undefined,
  }));

  const namespaces = Array.from(new Set(data.tools.map((t) => t.provider)));

  return c.json({ namespaces, services: serviceList });
});
