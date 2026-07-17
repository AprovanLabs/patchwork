/**
 * Gateway client for patchwork.
 *
 * Implements the `@aprovan/ui/gateway` GatewayClient contract (so
 * `useGatewaySession` works unchanged) on top of {@link gatewayFetch}, which
 * carries the token in `X-Aprovan-Authorization` and adds the CloudFront OAC
 * payload hash. The published `@aprovan/ui` client still sends the plain
 * `Authorization` header — which CloudFront's OAC signature overwrites — so we
 * keep a local implementation until a fixed package ships (the core repo's
 * source already uses `X-Aprovan-Authorization`); then this file can shrink
 * back to `createGatewayClient(...)`.
 */

import { GatewayError } from "@aprovan/ui/gateway";
import { gatewayFetch } from "./gateway-fetch";
import type {
  GatewayClient,
  GatewayRequestOptions,
  SessionInfo,
} from "@aprovan/ui/gateway";

const MCP_URL =
  (import.meta.env["VITE_MCP_URL"] as string | undefined) ||
  (import.meta.env.DEV ? "/gateway/mcp" : "https://aprovan.com/api/gateway/mcp");

/** Gateway base URL (MCP URL minus the trailing `/mcp`). */
export const GATEWAY_BASE = MCP_URL.replace(/\/mcp\/?$/, "");

async function parseError(res: Response): Promise<GatewayError> {
  let message = res.statusText;
  try {
    const body = (await res.json()) as { error?: string };
    if (typeof body.error === "string") message = body.error;
  } catch {
    // non-JSON body; keep statusText.
  }
  return new GatewayError(res.status, message);
}

async function request<T>(
  path: string,
  options: GatewayRequestOptions = {},
): Promise<T> {
  const { headers, workspaceId, ...init } = options;
  const merged: Record<string, string> = { ...headers };
  if (workspaceId) merged["X-Aprovan-Workspace"] = workspaceId;
  const res = await gatewayFetch(`${GATEWAY_BASE}${path}`, {
    ...init,
    headers: merged,
  });
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const gateway: GatewayClient = {
  request,
  getSession(): Promise<SessionInfo> {
    return request<SessionInfo>("/session");
  },
  async selectWorkspace(workspaceId: string): Promise<string> {
    const body = await request<{ activeWorkspaceId: string }>(
      "/session/workspace",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      },
    );
    return body.activeWorkspaceId;
  },
};
