/**
 * Gateway client for patchwork, built on the shared `@aprovan/ui/gateway` core.
 *
 * Authorizes with the Cognito access token synced by `lib/auth.ts`. Exposes the
 * standard session/workspace endpoints (`GET /session`, `POST /session/workspace`)
 * shared with the registry UI. Chat/tool endpoints stay inline in `ChatPage`.
 */

import { createGatewayClient } from "@aprovan/ui/gateway";
import { getAccessTokenSync } from "./auth";

const MCP_URL =
  (import.meta.env["VITE_MCP_URL"] as string | undefined) ||
  (import.meta.env.DEV ? "/gateway/mcp" : "https://aprovan.com/api/gateway/mcp");

/** Gateway base URL (MCP URL minus the trailing `/mcp`). */
export const GATEWAY_BASE = MCP_URL.replace(/\/mcp\/?$/, "");

export const gateway = createGatewayClient({
  baseUrl: GATEWAY_BASE,
  getToken: getAccessTokenSync,
});
