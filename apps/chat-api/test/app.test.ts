import { describe, it, expect } from "vitest";
import { createChatApp } from "../src/app";

describe("chat app", () => {
  const app = createChatApp();

  it("GET /health returns ok", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "ok" });
  });
});
