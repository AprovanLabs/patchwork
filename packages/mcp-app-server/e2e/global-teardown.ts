/**
 * Playwright global teardown — shuts down the in-process widget server started
 * by global-setup.ts.
 */

import type { Server } from "node:http";

export default async function globalTeardown(): Promise<void> {
  const server = (globalThis as Record<string, unknown>).__e2eWidgetServer as
    | Server
    | undefined;
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
