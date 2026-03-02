import { createMCPClient, type MCPTransport } from "@ai-sdk/mcp";
import { ServiceRegistry } from "@aprovan/stitchery";
import type { McpServerConfig } from "@aprovan/stitchery";

export interface EmbeddedStitcheryConfig {
  mcpServers?: McpServerConfig[];
}

export interface ServiceCallMessage {
  id: string;
  namespace: string;
  procedure: string;
  args: Record<string, unknown>;
}

export interface ServiceResultMessage {
  id: string;
  result?: unknown;
  error?: string;
}

export class EmbeddedStitchery {
  private registry = new ServiceRegistry();

  async initialize(config: EmbeddedStitcheryConfig = {}): Promise<void> {
    this.registry = new ServiceRegistry();
    const { mcpServers = [] } = config;

    if (mcpServers.length > 0) {
      await this.initMcpTools(mcpServers);
    }
  }

  async handleServiceCall(
    msg: ServiceCallMessage,
  ): Promise<ServiceResultMessage> {
    try {
      const result = await this.registry.call(
        msg.namespace,
        msg.procedure,
        msg.args,
      );
      return { id: msg.id, result };
    } catch (error) {
      return {
        id: msg.id,
        error: error instanceof Error ? error.message : "Service call failed",
      };
    }
  }

  getNamespaces(): string[] {
    return this.registry.getNamespaces();
  }

  private async initMcpTools(servers: McpServerConfig[]): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Experimental_StdioMCPTransport } = require("@ai-sdk/mcp/mcp-stdio") as {
      Experimental_StdioMCPTransport: new (config: { command: string; args?: string[] }) => MCPTransport;
    };
    for (const server of servers) {
      const client = await createMCPClient({
        transport: new Experimental_StdioMCPTransport({
          command: server.command,
          args: server.args,
        }),
      });
      this.registry.registerTools(await client.tools(), server.name);
    }
  }
}
