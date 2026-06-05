import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseRegistryToolName, createRegistryBackend } from "../registry-backend.js";
import type { Mock } from "vitest";
// ---------------------------------------------------------------------------
// Module-level mocks (hoisted by vitest)
// ---------------------------------------------------------------------------

// Shared mutable ref so each test can configure callTool behaviour.
let callToolImpl: Mock = vi.fn();

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(undefined),
    onmessage: null,
    onclose: null,
    onerror: null,
  })),
}));

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    callTool: (...args: Parameters<Mock>) => callToolImpl(...args),
    close: vi.fn().mockResolvedValue(undefined),
  })),
}));

// ---------------------------------------------------------------------------
// Import under test (after mocks are registered)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function textContent(text: string) {
  return { type: "text" as const, text };
}

function mockSuccess(text: string) {
  return Promise.resolve({ isError: false, content: [textContent(text)] });
}

function mockError(text: string) {
  return Promise.resolve({ isError: true, content: [textContent(text)] });
}

/**
 * Build a callTool mock that serves list_tools + tool_info for two providers.
 */
function twoToolCallTool() {
  return vi.fn().mockImplementation(({ name, arguments: args }: { name: string; arguments: Record<string, unknown> }) => {
    if (name === "list_tools") {
      return mockSuccess(JSON.stringify(["github__repos_list", "stripe__charges_list"]));
    }
    if (name === "tool_info") {
      const schemas: Record<string, object> = {
        github__repos_list: {
          name: "github__repos_list",
          description: "List GitHub repositories",
          inputSchema: {
            type: "object",
            properties: { per_page: { type: "number" } },
          },
        },
        stripe__charges_list: {
          name: "stripe__charges_list",
          description: "List Stripe charges",
          inputSchema: {
            type: "object",
            properties: { limit: { type: "number" } },
          },
        },
      };
      const schema = schemas[args["tool_name"] as string] ?? { name: args["tool_name"] };
      return mockSuccess(JSON.stringify(schema));
    }
    return mockError("unexpected call");
  });
}

// ---------------------------------------------------------------------------
// parseRegistryToolName
// ---------------------------------------------------------------------------

describe("parseRegistryToolName", () => {
  it("splits on first double-underscore", () => {
    expect(parseRegistryToolName("github__repos_list")).toEqual({
      namespace: "github",
      procedure: "repos_list",
    });
  });

  it("handles procedure with multiple underscores", () => {
    expect(parseRegistryToolName("stripe__payment_intents_create")).toEqual({
      namespace: "stripe",
      procedure: "payment_intents_create",
    });
  });

  it("handles provider with hyphen (e.g. google-cloud-run)", () => {
    expect(parseRegistryToolName("google-cloud-run__jobs_list")).toEqual({
      namespace: "google-cloud-run",
      procedure: "jobs_list",
    });
  });

  it("returns fallback procedure when no separator present", () => {
    expect(parseRegistryToolName("unknown")).toEqual({
      namespace: "unknown",
      procedure: "call",
    });
  });

  it("handles short names like provider__op", () => {
    expect(parseRegistryToolName("slack__conversations_info")).toEqual({
      namespace: "slack",
      procedure: "conversations_info",
    });
  });
});

// ---------------------------------------------------------------------------
// createRegistryBackend
// ---------------------------------------------------------------------------

describe("createRegistryBackend", () => {
  beforeEach(() => {
    // Reset to a fresh mock before each test so tests are independent.
    callToolImpl = twoToolCallTool();
  });

  it("loads tool infos from the Registry and maps them to ServiceToolInfo", async () => {
    const backend = await createRegistryBackend({
      command: "npx",
      args: ["@utdk/mcp"],
      providers: "github,stripe",
    });

    const tools = backend.getToolInfos();
    expect(tools).toHaveLength(2);

    const githubTool = tools.find((t) => t.namespace === "github");
    expect(githubTool).toBeDefined();
    expect(githubTool?.procedure).toBe("repos_list");
    expect(githubTool?.name).toBe("github.repos_list");
    expect(githubTool?.description).toBe("List GitHub repositories");

    const stripeTool = tools.find((t) => t.namespace === "stripe");
    expect(stripeTool).toBeDefined();
    expect(stripeTool?.procedure).toBe("charges_list");
    expect(stripeTool?.name).toBe("stripe.charges_list");
  });

  it("calls the Registry call_tool meta-tool with the correct tool name and args", async () => {
    const captured: { name: string; arguments: Record<string, unknown> }[] = [];

    callToolImpl = vi.fn().mockImplementation(({ name, arguments: args }: { name: string; arguments: Record<string, unknown> }) => {
      captured.push({ name, arguments: args });
      if (name === "list_tools") return mockSuccess(JSON.stringify(["github__repos_list"]));
      if (name === "tool_info") {
        return mockSuccess(JSON.stringify({ name: "github__repos_list", description: "List repos" }));
      }
      if (name === "call_tool") {
        return mockSuccess(JSON.stringify([{ name: "my-repo" }]));
      }
      return mockError("unexpected");
    });

    const backend = await createRegistryBackend({
      command: "npx",
      args: ["@utdk/mcp"],
      providers: "github",
    });

    const result = await backend.call("github", "repos_list", [{ per_page: 10 }]);

    // Verify the result is parsed JSON
    expect(result).toEqual([{ name: "my-repo" }]);

    // Verify call_tool was invoked with the right tool name and arguments
    const callToolInvocation = captured.find((c) => c.name === "call_tool");
    expect(callToolInvocation).toBeDefined();
    expect(callToolInvocation?.arguments["tool_name"]).toBe("github__repos_list");
    expect(callToolInvocation?.arguments["arguments"]).toEqual({ per_page: 10 });
  });

  it("throws when the Registry returns isError = true", async () => {
    callToolImpl = vi.fn().mockImplementation(({ name }: { name: string }) => {
      if (name === "list_tools") return mockSuccess(JSON.stringify([]));
      if (name === "call_tool") return mockError("Unknown tool: bad__tool");
      return mockError("unexpected");
    });

    const backend = await createRegistryBackend({
      command: "npx",
      args: ["@utdk/mcp"],
      providers: "bad",
    });

    await expect(backend.call("bad", "tool", [{}])).rejects.toThrow("Unknown tool: bad__tool");
  });

  it("parses JSON response from call_tool automatically", async () => {
    callToolImpl = vi.fn().mockImplementation(({ name }: { name: string }) => {
      if (name === "list_tools") return mockSuccess(JSON.stringify([]));
      if (name === "call_tool") {
        return mockSuccess(JSON.stringify({ id: "ch_123", amount: 5000 }));
      }
      return mockError("unexpected");
    });

    const backend = await createRegistryBackend({
      command: "npx",
      args: ["@utdk/mcp"],
      providers: "stripe",
    });

    const result = await backend.call("stripe", "charges_retrieve", [{ id: "ch_123" }]);
    expect(result).toEqual({ id: "ch_123", amount: 5000 });
  });

  it("returns plain text when response is not valid JSON", async () => {
    callToolImpl = vi.fn().mockImplementation(({ name }: { name: string }) => {
      if (name === "list_tools") return mockSuccess(JSON.stringify([]));
      if (name === "call_tool") return mockSuccess("plain text response");
      return mockError("unexpected");
    });

    const backend = await createRegistryBackend({
      command: "npx",
      args: ["@utdk/mcp"],
      providers: "some",
    });

    const result = await backend.call("some", "op", [{}]);
    expect(result).toBe("plain text response");
  });

  it("handles an empty tool list gracefully", async () => {
    callToolImpl = vi.fn().mockImplementation(({ name }: { name: string }) => {
      if (name === "list_tools") return mockSuccess(JSON.stringify([]));
      return mockError("should not be called");
    });

    const backend = await createRegistryBackend({
      command: "npx",
      args: ["@utdk/mcp"],
      providers: "",
    });

    expect(backend.getToolInfos()).toHaveLength(0);
  });
});
