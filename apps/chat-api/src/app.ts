import { Hono } from "hono";
import { authMiddleware } from "./middleware/auth";
import { workspaceMiddleware } from "./middleware/workspace";
import { planMiddleware } from "./middleware/plan";
import { health } from "./routes/health";
import type { AppVariables } from "./types";

export function createChatApp() {
  const app = new Hono<{ Variables: AppVariables }>();

  // Unauthenticated routes
  app.route("/", health);

  // Protected route group: auth → workspace → plan
  const api = app.basePath("/api");
  api.use(authMiddleware, workspaceMiddleware, planMiddleware);

  return app;
}

export type ChatApp = ReturnType<typeof createChatApp>;
