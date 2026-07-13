/**
 * Cognito auth for the patchwork web client.
 *
 * Thin registration over the shared `@aprovan/ui/auth` client. Config comes from
 * `VITE_COGNITO_*` (populated from SSM `/aprovan/prd/env` by `scripts/load-env.ts`).
 * The access token is mirrored into `localStorage["patchwork:authToken"]` so
 * existing gateway call sites in `ChatPage` keep reading it synchronously.
 *
 * When Cognito is not configured (e.g. `APROVAN_ENV=off`), `configureAuth`
 * returns null and the app runs unauthenticated (`isAuthConfigured()` → false).
 */

import { configureAuth, resolveAuthConfig } from "@aprovan/ui/auth";

/** Storage key the rest of patchwork reads the Cognito access token from. */
export const AUTH_TOKEN_KEY = "patchwork:authToken";

const config = resolveAuthConfig(import.meta.env, {
  basePath: "/chat",
  redirectPath: "/auth/callback",
  tokenStorageKey: AUTH_TOKEN_KEY,
});

/** The app-wide auth client, or null when Cognito is not configured. */
export const authClient = configureAuth(config);

export { getAccessTokenSync, isAuthConfigured } from "@aprovan/ui/auth";
