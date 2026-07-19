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

/** Public MCP endpoint (REST and MCP no longer share a prefix). */
export const MCP_URL =
  (import.meta.env["VITE_MCP_URL"] as string | undefined) ||
  (import.meta.env.DEV ? "/gateway/mcp" : "https://aprovan.com/api/mcp");

/** Gateway REST base URL. */
export const GATEWAY_BASE =
  (import.meta.env["VITE_GATEWAY_URL"] as string | undefined)?.replace(/\/$/, "") ||
  (import.meta.env.DEV ? "/gateway" : "https://aprovan.com/api/gateway");

export const gateway: GatewayClient = createGatewayClient({
  baseUrl: GATEWAY_BASE,
  getToken: getAccessTokenSync,
});
