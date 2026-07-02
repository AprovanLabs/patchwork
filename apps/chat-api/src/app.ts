import { Hono } from "hono";
import { health } from "./routes/health";

export function createChatApp() {
  const app = new Hono();

  app.route("/", health);

  return app;
}

export type ChatApp = ReturnType<typeof createChatApp>;
