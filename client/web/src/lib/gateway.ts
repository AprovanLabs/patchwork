/**
 * Gateway client for patchwork.
 *
 * `@aprovan/ui` ≥0.2.3 sends the token in `X-Aprovan-Authorization` (which
 * survives CloudFront's OAC signing), and the deployed `oac-body-hash`
 * Lambda@Edge injects the payload hash for bodied requests — so the shared
 * `createGatewayClient` works unmodified here. `gatewayFetch` (see
 * ./gateway-fetch) remains as the low-level authorized fetch used by the chat
 * transport; its client-side body hashing is now an optimization only.
 */

import { createGatewayClient } from "@aprovan/ui/gateway";
import { getAccessTokenSync } from "./auth";
import type { GatewayClient } from "@aprovan/ui/gateway";

const MCP_URL =
  (import.meta.env["VITE_MCP_URL"] as string | undefined) ||
  (import.meta.env.DEV ? "/gateway/mcp" : "https://aprovan.com/api/gateway/mcp");

/** Gateway base URL (MCP URL minus the trailing `/mcp`). */
export const GATEWAY_BASE = MCP_URL.replace(/\/mcp\/?$/, "");

export const gateway: GatewayClient = createGatewayClient({
  baseUrl: GATEWAY_BASE,
  getToken: getAccessTokenSync,
});
