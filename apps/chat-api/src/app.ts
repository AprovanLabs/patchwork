import { Hono } from "hono";
import { authMiddleware } from "./middleware/auth.js";
import { planMiddleware } from "./middleware/plan.js";
import { workspaceMiddleware } from "./middleware/workspace.js";
import { chatRoute } from "./routes/chat.js";
import { editRoute } from "./routes/edit.js";
import { health } from "./routes/health.js";
import { proxy } from "./routes/proxy.js";
import { services } from "./routes/services.js";
import { workspacesRoute } from "./routes/workspaces.js";
import type { AppVariables } from "./types.js";

export { initPostHog } from "./posthog.js";

export function createChatApp() {
  const app = new Hono<{ Variables: AppVariables }>();

  // Unauthenticated routes
  app.route("/", health);

  // Protected route group: auth → workspace → plan
  const api = app.basePath("/api");
  api.use(authMiddleware, workspaceMiddleware, planMiddleware);
  api.route("/chat", chatRoute);
  api.route("/edit", editRoute);
  api.route("/services", services);
  api.route("/proxy", proxy);
  api.route("/workspaces", workspacesRoute);

  return app;
}

export type ChatApp = ReturnType<typeof createChatApp>;
