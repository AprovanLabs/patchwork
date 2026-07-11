import { Hono } from "hono";
import { authMiddleware } from "./middleware/auth.js";
import { planMiddleware } from "./middleware/plan.js";
import { workspaceMiddleware } from "./middleware/workspace.js";
import { chatRoute } from "./routes/chat.js";
import { editRoute } from "./routes/edit.js";
import { health } from "./routes/health.js";
import { workspaceRoute } from "./routes/workspace.js";
import { workspacesRoute } from "./routes/workspaces.js";
import type { AppVariables } from "./types.js";

export { initPostHog } from "./posthog.js";

export function createChatApp() {
  const app = new Hono<{ Variables: AppVariables }>();

  // Unauthenticated routes
  app.route("/", health);

  // Auth-only routes (workspace switch — no workspace context required)
  const authOnly = new Hono<{ Variables: AppVariables }>();
  authOnly.use("/*", authMiddleware);
  authOnly.route("/workspace", workspaceRoute);
  app.route("/api", authOnly);

  // Protected routes: auth → workspace → plan
  const api = new Hono<{ Variables: AppVariables }>();
  api.use("/*", authMiddleware, workspaceMiddleware, planMiddleware);
  api.route("/chat", chatRoute);
  api.route("/edit", editRoute);
  api.route("/workspaces", workspacesRoute);
  app.route("/api", api);

  return app;
}

export type ChatApp = ReturnType<typeof createChatApp>;
