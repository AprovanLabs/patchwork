import { createMCPClient } from "@ai-sdk/mcp";
import { Experimental_StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import { createUtcpBackend } from "@aprovan/patchwork-utcp";
import { ServiceRegistry } from "@aprovan/stitchery";
import type { McpServerConfig, UtcpConfig } from "@aprovan/stitchery";

export interface EmbeddedStitcheryConfig {
  utcp?: UtcpConfig;
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
    const { utcp, mcpServers = [] } = config;

    if (mcpServers.length > 0) {
      await this.initMcpTools(mcpServers);
    }

    if (utcp) {
      try {
        const { backend, toolInfos } = await createUtcpBackend(
          utcp as Parameters<typeof createUtcpBackend>[0],
          utcp.cwd,
        );
        this.registry.registerBackend(backend, toolInfos);
      } catch (error) {
        console.error("[patchwork-vscode] UTCP init failed:", error);
      }
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
