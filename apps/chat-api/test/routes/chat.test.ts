import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { Hono } from "hono";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AppVariables, WorkspaceItem } from "../../src/types";
import type { CognitoAccessTokenPayload } from "aws-jwt-verify/jwt-model";

// hoisted mocks — must be declared before vi.mock calls
const { mockGetOpenRouterKey, mockCreateOpenRouterProvider, mockProviderFactory } =
  vi.hoisted(() => {
    const mockProviderFactory = vi.fn();
    return {
      mockGetOpenRouterKey: vi.fn().mockResolvedValue("test-key"),
      mockCreateOpenRouterProvider: vi.fn().mockReturnValue(mockProviderFactory),
      mockProviderFactory,
    };
  });

vi.mock("../../src/providers/openrouter.js", () => ({
  getOpenRouterKey: mockGetOpenRouterKey,
  createOpenRouterProvider: mockCreateOpenRouterProvider,
}));

// Import the route AFTER mocks are in place
const { chatRoute } = await import("../../src/routes/chat.js");

const fakeWorkspace: WorkspaceItem = {
  workspaceId: "ws-test",
  name: "Test Workspace",
  plan: "free",
  limits: {
    dailyChatCap: 50,
    maxModels: ["openrouter/auto"],
    maxToolSteps: 5,
    maxTokensPerRequest: 4096,
  },
  features: {
    advancedTools: false,
    customPrompts: false,
  },
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-01T00:00:00Z",
};

const fakeClaims = { sub: "user-sub-test" } as unknown as CognitoAccessTokenPayload;

function buildApp(workspace: WorkspaceItem = fakeWorkspace) {
  const app = new Hono<{ Variables: AppVariables }>();
  // Bypass auth / workspace / plan middleware
  app.use("/chat/*", async (c, next) => {
    c.set("claims", fakeClaims);
    c.set("workspaceId", workspace.workspaceId);
    c.set("workspace", workspace);
    await next();
  });
  app.route("/chat", chatRoute);
  return app;
}

const validBody = JSON.stringify({
  id: "chat-1",
  messages: [{ role: "user", parts: [{ type: "text", text: "Hello" }], id: "msg-1" }],
  trigger: "submit-message",
});

const validHeaders = { "Content-Type": "application/json" };

function makeSuccessStream() {
  return simulateReadableStream({
    chunks: [
      { type: "stream-start", warnings: [] },
      { type: "text-start", id: "txt-1" },
      { type: "text-delta", id: "txt-1", delta: "Hello!" },
      { type: "text-end", id: "txt-1" },
      {
        type: "finish",
        finishReason: { unified: "stop" as const, raw: "stop" },
        usage: {
          inputTokens: { total: 5, noCache: 5, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 3, text: 3, reasoning: undefined },
        },
      },
    ],
  });
}

function makePartialThenErrorStream() {
  return simulateReadableStream({
    chunks: [
      { type: "stream-start", warnings: [] },
      { type: "text-start", id: "txt-1" },
      { type: "text-delta", id: "txt-1", delta: "Part" },
      { type: "text-end", id: "txt-1" },
      { type: "error", error: new Error("upstream connection lost") },
    ],
  });
}

describe("POST /chat", () => {
  let mockDoStream: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDoStream = vi.fn();
    // Wire: createOpenRouterProvider(key) → providerFactory(modelId) → MockLanguageModelV3
    const mockModel = new MockLanguageModelV3({ doStream: mockDoStream });
    mockProviderFactory.mockReturnValue(mockModel);
    mockCreateOpenRouterProvider.mockReturnValue(mockProviderFactory);
  });

  it("returns 400 for invalid request body", async () => {
    const app = buildApp();
    const res = await app.request("/chat", {
      method: "POST",
      headers: validHeaders,
      body: JSON.stringify({ wrong: "shape" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ error: "Invalid request body" });
  });

  it("streams UI-message stream for a valid request", async () => {
    mockDoStream.mockResolvedValueOnce({
      stream: makeSuccessStream(),
      rawResponse: { headers: {} },
    });

    const app = buildApp();
    const res = await app.request("/chat", {
      method: "POST",
      headers: validHeaders,
      body: validBody,
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch("text/event-stream");
    const text = await res.text();
    expect(text).toContain('"type":"text-delta"');
    expect(text).toContain('"delta":"Hello!"');
    expect(mockDoStream).toHaveBeenCalledTimes(1);
  });

  it("retries once on pre-stream error; if second call also fails, surfaces error part", async () => {
    const upstreamError = new Error("503 Service Unavailable");
    mockDoStream
      .mockRejectedValueOnce(upstreamError)  // first attempt
      .mockRejectedValueOnce(upstreamError); // retry attempt

    const app = buildApp();
    const res = await app.request("/chat", {
      method: "POST",
      headers: validHeaders,
      body: validBody,
    });

    // Response is still a streaming UI-message stream (error part inside)
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch("text/event-stream");
    const text = await res.text();
    expect(text).toContain('"type":"error"');
    // Exactly two doStream calls: initial attempt + one retry
    expect(mockDoStream).toHaveBeenCalledTimes(2);
  });

  it("retries once on pre-stream error; succeeds on retry", async () => {
    const upstreamError = new Error("503 Service Unavailable");
    mockDoStream
      .mockRejectedValueOnce(upstreamError)   // first attempt fails
      .mockResolvedValueOnce({                // retry succeeds
        stream: makeSuccessStream(),
        rawResponse: { headers: {} },
      });

    const app = buildApp();
    const res = await app.request("/chat", {
      method: "POST",
      headers: validHeaders,
      body: validBody,
    });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('"type":"text-delta"');
    expect(mockDoStream).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry when OpenRouter fails mid-stream", async () => {
    mockDoStream.mockResolvedValueOnce({
      stream: makePartialThenErrorStream(),
      rawResponse: { headers: {} },
    });

    const app = buildApp();
    const res = await app.request("/chat", {
      method: "POST",
      headers: validHeaders,
      body: validBody,
    });

    expect(res.status).toBe(200);
    const text = await res.text();
    // Got some real text before the error
    expect(text).toContain('"type":"text-delta"');
    // Error part is present in the stream
    expect(text).toContain('"type":"error"');
    // doStream was called only once (no retry for mid-stream errors)
    expect(mockDoStream).toHaveBeenCalledTimes(1);
  });

  it("selects model from workspace.limits.maxModels[0]", async () => {
    mockDoStream.mockResolvedValueOnce({
      stream: makeSuccessStream(),
      rawResponse: { headers: {} },
    });

    const proWorkspace: WorkspaceItem = {
      ...fakeWorkspace,
      plan: "pro",
      limits: { ...fakeWorkspace.limits, maxModels: ["anthropic/claude-opus-4"] },
    };

    const app = buildApp(proWorkspace);
    await app.request("/chat", {
      method: "POST",
      headers: validHeaders,
      body: validBody,
    });

    // The provider factory should have been called with the plan's first model
    expect(mockProviderFactory).toHaveBeenCalledWith("anthropic/claude-opus-4");
  });
});
