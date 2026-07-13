import {
  PatchworkMcpClient,
  type McpServerConfig,
  type PatchworkTool,
} from "@aprovan/patchwork";
import type { ServiceBackend, ServiceToolInfo } from "./services.js";

export type RegistryBackendOptions = Omit<McpServerConfig, "mode">;

export interface RegistryBackend extends ServiceBackend {
  getToolInfos(): ServiceToolInfo[];
  readArtifact(uri: string): Promise<unknown>;
  close(): Promise<void>;
}

function splitTool(tool: PatchworkTool): ServiceToolInfo {
  const separator = tool.name.indexOf(".");
  return {
    name: tool.name,
    namespace: separator < 0 ? tool.name : tool.name.slice(0, separator),
    procedure: separator < 0 ? tool.name : tool.name.slice(separator + 1),
    description: tool.description,
    parameters:
      tool.inputSchema && typeof tool.inputSchema === "object"
        ? (tool.inputSchema as Record<string, unknown>)
        : undefined,
  };
}

export async function createRegistryBackend(
  options: RegistryBackendOptions,
): Promise<RegistryBackend> {
  const client = new PatchworkMcpClient({ ...options, mode: "toolbox" });
  await client.connect();
  const tools = (await client.listTools()).map(splitTool);
  return {
    call(namespace, procedure, args) {
      return client.callTool(
        `${namespace}.${procedure}`,
        (args[0] as Record<string, unknown> | undefined) ?? {},
      );
    },
    getToolInfos: () => tools,
    readArtifact: (uri) => client.readResource(uri),
    close: () => client.close(),
  };
}
