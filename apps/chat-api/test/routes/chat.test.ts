import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { Hono } from "hono";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AppVariables, WorkspaceItem } from "../../src/types";
import type { CognitoAccessTokenPayload } from "aws-jwt-verify/jwt-model";

// ── Hoisted mocks — must be declared before vi.mock calls ────────────────────

const {
  mockGetOpenRouterKey,
  mockCreateOpenRouterProvider,
  mockProviderFactory,
  mockGetGatewaySession,
  mockEvictGatewaySession,
  mockGetCachedTools,
  mockSetCachedTools,
  mockGetPrompt,
  mockCompilePrompt,
  mockGetPostHogClient,
  mockGetToolDocs,
  mockMakeHttpGatewayClient,
} = vi.hoisted(() => {
  const mockProviderFactory = vi.fn();
  return {
    mockGetOpenRouterKey: vi.fn().mockResolvedValue("test-key"),
    mockCreateOpenRouterProvider: vi.fn().mockReturnValue(mockProviderFactory),
    mockProviderFactory,
    mockGetGatewaySession: vi.fn(),
    mockEvictGatewaySession: vi.fn(),
    mockGetCachedTools: vi.fn().mockReturnValue(undefined),
    mockSetCachedTools: vi.fn(),
    mockGetPrompt: vi.fn().mockResolvedValue({
      source: "code_fallback",
      prompt: "System: {{compilers}} {{tool_docs}}",
      name: undefined,
      version: undefined,
    }),
    mockCompilePrompt: vi
      .fn()
      .mockImplementation(
        (template: string, vars: Record<string, string>) =>
          template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? ""),
      ),
    mockGetPostHogClient: vi.fn().mockReturnValue(null),
    mockGetToolDocs: vi.fn().mockResolvedValue(""),
    mockMakeHttpGatewayClient: vi.fn().mockReturnValue(null),
  };
});

vi.mock("../../src/providers/openrouter.js", () => ({
  getOpenRouterKey: mockGetOpenRouterKey,
  createOpenRouterProvider: mockCreateOpenRouterProvider,
}));

vi.mock("../../src/gateway-session.js", () => ({
  getGatewaySession: mockGetGatewaySession,
  evictGatewaySession: mockEvictGatewaySession,
  getCachedTools: mockGetCachedTools,
  setCachedTools: mockSetCachedTools,
  GatewaySessionError: class GatewaySessionError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  resetGatewaySessionCache: vi.fn(),
}));

vi.mock("../../src/posthog.js", () => ({
  getPrompt: mockGetPrompt,
  compilePrompt: mockCompilePrompt,
  getPostHogClient: mockGetPostHogClient,
}));

vi.mock("../../src/tool-docs.js", () => ({
  getToolDocs: mockGetToolDocs,
  makeHttpGatewayClient: mockMakeHttpGatewayClient,
}));

// Global fetch stub — reset per-test; not used unless GATEWAY_URL is set.
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Import the route AFTER mocks are in place
const { chatRoute } = await import("../../src/routes/chat.js");

// ── Test fixtures ─────────────────────────────────────────────────────────────

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

const MOCK_TOOLS_RESPONSE = {
  tools: [
    {
      provider: "github",
      name: "github.repos_list",
      operation: "repos_list",
      description: "List repos",
      inputSchema: { type: "object", properties: { per_page: { type: "number" } } },
    },
  ],
  workspace_id: "ws-test",
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /chat", () => {
  let mockDoStream: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    delete process.env["GATEWAY_URL"];

    mockDoStream = vi.fn();
    // Wire: createOpenRouterProvider(key) → providerFactory(modelId) → MockLanguageModelV3
    const mockModel = new MockLanguageModelV3({ doStream: mockDoStream });
    mockProviderFactory.mockReturnValue(mockModel);
    mockCreateOpenRouterProvider.mockReturnValue(mockProviderFactory);
    mockGetOpenRouterKey.mockResolvedValue("test-key");
    mockGetCachedTools.mockReturnValue(undefined);
    mockSetCachedTools.mockReset();

    // Reset prompt + tool-docs mocks to defaults
    mockGetPrompt.mockResolvedValue({
      source: "code_fallback",
      prompt: "System: {{compilers}} {{tool_docs}}",
      name: undefined,
      version: undefined,
    });
    mockCompilePrompt.mockImplementation(
      (template: string, vars: Record<string, string>) =>
        template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? ""),
    );
    mockGetPostHogClient.mockReturnValue(null);
    mockGetToolDocs.mockResolvedValue("");
    mockMakeHttpGatewayClient.mockReturnValue(null);
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

  // ── Prompt loading ──────────────────────────────────────────────────────────

  it("defaults to chat-patchwork-widget when prompt field is omitted", async () => {
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
    expect(mockGetPrompt).toHaveBeenCalledWith("chat-patchwork-widget");
  });

  it("loads the correct prompt and compiles with compilers + tool_docs", async () => {
    mockGetPrompt.mockResolvedValue({
      source: "code_fallback",
      prompt: "---\ncompilers: {{compilers}}\n---\n{{tool_docs}}",
      name: undefined,
      version: undefined,
    });
    mockGetToolDocs.mockResolvedValue("## Services\n- weather");
    mockDoStream.mockResolvedValueOnce({
      stream: makeSuccessStream(),
      rawResponse: { headers: {} },
    });

    const app = buildApp();
    const res = await app.request("/chat", {
      method: "POST",
      headers: validHeaders,
      body: JSON.stringify({
        id: "chat-1",
        messages: [{ role: "user", parts: [{ type: "text", text: "hi" }], id: "m1" }],
        trigger: "submit-message",
        prompt: {
          id: "chat-patchwork-widget",
          vars: { compilers: ["@aprovan/patchwork-image-shadcn"] },
        },
      }),
    });

    expect(res.status).toBe(200);
    expect(mockGetPrompt).toHaveBeenCalledWith("chat-patchwork-widget");
    expect(mockCompilePrompt).toHaveBeenCalledWith(
      "---\ncompilers: {{compilers}}\n---\n{{tool_docs}}",
      expect.objectContaining({
        compilers: "@aprovan/patchwork-image-shadcn",
        tool_docs: "## Services\n- weather",
      }),
    );
  });

  it("returns 400 for an unknown promptId", async () => {
    const app = buildApp();
    const res = await app.request("/chat", {
      method: "POST",
      headers: validHeaders,
      body: JSON.stringify({
        id: "chat-1",
        messages: [{ role: "user", parts: [{ type: "text", text: "hi" }], id: "m1" }],
        trigger: "submit-message",
        prompt: { id: "unknown-prompt-id" },
      }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toMatchObject({ error: "Unknown prompt id" });
  });

  it("accepts chat-plain as a valid promptId", async () => {
    mockDoStream.mockResolvedValueOnce({
      stream: makeSuccessStream(),
      rawResponse: { headers: {} },
    });

    const app = buildApp();
    const res = await app.request("/chat", {
      method: "POST",
      headers: validHeaders,
      body: JSON.stringify({
        id: "chat-1",
        messages: [{ role: "user", parts: [{ type: "text", text: "hi" }], id: "m1" }],
        trigger: "submit-message",
        prompt: { id: "chat-plain" },
      }),
    });

    expect(res.status).toBe(200);
    expect(mockGetPrompt).toHaveBeenCalledWith("chat-plain");
  });

  // ── Gateway tool wiring ────────────────────────────────────────────────────

  describe("when GATEWAY_URL is configured", () => {
    beforeEach(() => {
      process.env["GATEWAY_URL"] = "https://gateway.test";
      mockGetGatewaySession.mockResolvedValue({
        token: "session-bearer",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      });
    });

    afterEach(() => {
      delete process.env["GATEWAY_URL"];
    });

    it("fetches gateway tools and passes them to the model", async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(MOCK_TOOLS_RESPONSE), { status: 200 }),
      );
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
      // Gateway tools endpoint was called with the session bearer
      const [toolsUrl, toolsOpts] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(toolsUrl).toBe("https://gateway.test/tools");
      expect((toolsOpts.headers as Record<string, string>)["Authorization"]).toBe(
        "Bearer session-bearer",
      );
    });

    it("requests a gateway session with the correct claims and workspace ID", async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(MOCK_TOOLS_RESPONSE), { status: 200 }),
      );
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
      expect(mockGetGatewaySession).toHaveBeenCalledOnce();
      expect(mockGetGatewaySession).toHaveBeenCalledWith(
        fakeClaims,
        fakeWorkspace.workspaceId,
        expect.any(String),
      );
    });

    it("uses cached tools when available — skips gateway fetch", async () => {
      mockGetCachedTools.mockReturnValue(MOCK_TOOLS_RESPONSE.tools);
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
      // No gateway tools fetch should have occurred
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("caches fetched tools via setCachedTools", async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(MOCK_TOOLS_RESPONSE), { status: 200 }),
      );
      mockDoStream.mockResolvedValueOnce({
        stream: makeSuccessStream(),
        rawResponse: { headers: {} },
      });

      const app = buildApp();
      await app.request("/chat", {
        method: "POST",
        headers: validHeaders,
        body: validBody,
      });

      expect(mockSetCachedTools).toHaveBeenCalledOnce();
      expect(mockSetCachedTools).toHaveBeenCalledWith(
        fakeClaims.sub,
        MOCK_TOOLS_RESPONSE.tools,
      );
    });
  });
});
