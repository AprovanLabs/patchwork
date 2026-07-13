import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";

export interface McpServerConfig {
  name: string;
  url: string;
  mode?: "direct" | "toolbox";
  headers?: Record<string, string>;
  auth?:
    | { type: "oauth"; provider: OAuthClientProvider }
    | { type: "bearer"; token: string }
    | { type: "none" };
}

export interface PatchworkTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export class PatchworkMcpClient {
  private client?: Client;
  private mode?: "direct" | "toolbox";

  constructor(private readonly config: McpServerConfig) {}

  async connect(): Promise<void> {
    const headers = new Headers(this.config.headers);
    if (this.config.auth?.type === "bearer") {
      headers.set("Authorization", `Bearer ${this.config.auth.token}`);
    }
    this.client = new Client(
      { name: "@aprovan/patchwork-main", version: "0.1.0" },
      { capabilities: {} },
    );
    await this.client.connect(
      new StreamableHTTPClientTransport(new URL(this.config.url), {
        authProvider:
          this.config.auth?.type === "oauth"
            ? this.config.auth.provider
            : undefined,
        requestInit: { headers },
      }),
    );
    const listed = await this.client.listTools();
    const names = listed.tools.map((tool) => tool.name).sort();
    this.mode =
      this.config.mode ??
      (names.join(",") ===
      ["call_tool", "list_tools", "search_tools", "tool_info"].sort().join(",")
        ? "toolbox"
        : "direct");
  }

  async listTools(query?: string): Promise<PatchworkTool[]> {
    const client = this.requireClient();
    if (this.mode === "direct") {
      const { tools } = await client.listTools();
      return tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }));
    }
    const response = await client.callTool({
      name: query ? "search_tools" : "list_tools",
      arguments: query ? { query } : {},
    });
    return this.parseTextResult<PatchworkTool[]>(response.content);
  }

  async toolInfo(toolName: string): Promise<unknown> {
    if (this.mode === "direct") {
      return (await this.listTools()).find((tool) => tool.name === toolName);
    }
    const response = await this.requireClient().callTool({
      name: "tool_info",
      arguments: { tool_name: toolName },
    });
    return this.parseTextResult(response.content);
  }

  async callTool(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const response = await this.requireClient().callTool(
      this.mode === "toolbox"
        ? {
            name: "call_tool",
            arguments: { tool_name: toolName, args },
          }
        : { name: toolName, arguments: args },
    );
    if (response.isError) throw new Error(this.text(response.content));
    return this.parseTextResult(response.content);
  }

  async getPrompt(name: string, args?: Record<string, string>): Promise<unknown> {
    return this.requireClient().getPrompt({ name, arguments: args });
  }

  async readResource(uri: string): Promise<unknown> {
    return this.requireClient().readResource({ uri });
  }

  async close(): Promise<void> {
    await this.client?.close();
    this.client = undefined;
  }

  private requireClient(): Client {
    if (!this.client || !this.mode) throw new Error("MCP client is not connected");
    return this.client;
  }

  private text(content: unknown): string {
    if (!Array.isArray(content)) return "";
    return content
      .filter(
        (item): item is { type: "text"; text: string } =>
          Boolean(item) &&
          typeof item === "object" &&
          (item as { type?: unknown }).type === "text",
      )
      .map((item) => item.text)
      .join("\n");
  }

  private parseTextResult<T = unknown>(content: unknown): T {
    const text = this.text(content);
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as T;
    }
  }
}
