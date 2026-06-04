/**
 * Registry MCP backend for the Patchwork MCP App Server.
 *
 * Spawns (or connects to) the Aprovan Registry MCP server via stdio and bridges
 * its tools into the Patchwork ServiceBridge. Widgets can then call any Registry-
 * backed service (e.g. `github.repos_list()`, `stripe.charges_list()`) via the
 * standard Patchwork service proxy shim.
 *
 * Usage (in server.ts or programmatically):
 *
 *   const backend = await createRegistryBackend({
 *     command: "npx",
 *     args: ["@utdk/mcp-server"],
 *     providers: "github,slack,stripe",
 *   });
 *
 *   const bridge = new ServiceBridge({
 *     backend,
 *     tools: backend.getToolInfos(),
 *   });
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { ServiceBackend, ServiceToolInfo } from "./services.js";

// ---------------------------------------------------------------------------
// Minimal type alias for MCP callTool responses
// ---------------------------------------------------------------------------

/** Subset of the MCP CallToolResult used in this module. */
interface McpToolResult {
  isError?: boolean;
  content: Array<{ type: string; text?: string; [k: string]: unknown }>;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RegistryBackendOptions {
  /** Executable to start the Registry MCP server (e.g. "npx" or an absolute path). */
  command: string;
  /** Arguments passed to the command (e.g. ["@utdk/mcp-server"]). */
  args?: string[];
  /**
   * Additional environment variables for the Registry process.
   * Merged on top of the current process.env, so provider credentials already
   * present in the environment are forwarded automatically.
   */
  env?: Record<string, string>;
  /**
   * Comma-separated list of `@utdk` providers to load, e.g. "github,slack,stripe".
   * Passed as UTDK_PROVIDERS to the Registry server.
   */
  providers: string;
}

export interface RegistryBackend extends ServiceBackend {
  /** All service tool infos loaded from the Registry, ready for ServiceBridgeConfig. */
  getToolInfos(): ServiceToolInfo[];
  /** Close the underlying MCP client / Registry child process. */
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Split a Registry MCP tool name (e.g. "github__repos_list") into its
 * namespace ("github") and procedure ("repos_list") parts.
 *
 * The Registry convention is:
 *   <provider>__<operation>   (double underscore as separator)
 *
 * Everything before the first "__" is the namespace; the remainder is the
 * procedure (which may itself contain single underscores).
 */
export function parseRegistryToolName(mcpName: string): {
  namespace: string;
  procedure: string;
} {
  const idx = mcpName.indexOf("__");
  if (idx === -1) {
    // No separator — treat the whole name as a single-part namespace
    return { namespace: mcpName, procedure: "call" };
  }
  return {
    namespace: mcpName.slice(0, idx),
    procedure: mcpName.slice(idx + 2),
  };
}

/**
 * Fetch all tool metadata from the Registry via its `list_tools` / `tool_info`
 * meta-tools and convert to the `ServiceToolInfo` shape expected by ServiceBridge.
 */
async function loadRegistryToolInfos(client: Client): Promise<ServiceToolInfo[]> {
  // list_tools returns a flat JSON array of MCP tool names when no group_by is given.
  const listResult = (await client.callTool({
    name: "list_tools",
    arguments: {},
  })) as McpToolResult;

  const listText = listResult.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("");

  let toolNames: unknown;
  try {
    toolNames = JSON.parse(listText);
  } catch {
    console.warn("[registry-backend] Failed to parse tool list response from Registry");
    return [];
  }

  if (!Array.isArray(toolNames)) {
    console.warn("[registry-backend] Unexpected tool list format from Registry (expected array)");
    return [];
  }

  const mcpNames = toolNames.filter((n): n is string => typeof n === "string");

  // Fetch full schema for each tool in parallel, chunked to avoid flooding the process.
  const CHUNK_SIZE = 20;
  const toolInfos: ServiceToolInfo[] = [];

  for (let i = 0; i < mcpNames.length; i += CHUNK_SIZE) {
    const chunk = mcpNames.slice(i, i + CHUNK_SIZE);
    const results = await Promise.all(
      chunk.map(async (mcpName): Promise<ServiceToolInfo | null> => {
        try {
          const infoResult = (await client.callTool({
            name: "tool_info",
            arguments: { tool_name: mcpName },
          })) as McpToolResult;

          const infoText = infoResult.content
            .filter((c): c is { type: "text"; text: string } => c.type === "text")
            .map((c) => c.text)
            .join("");

          const raw = JSON.parse(infoText) as {
            name?: string;
            description?: string;
            inputSchema?: Record<string, unknown>;
          };

          const { namespace, procedure } = parseRegistryToolName(mcpName);

          return {
            name: `${namespace}.${procedure}`,
            namespace,
            procedure,
            description: raw.description ?? `Call ${namespace}.${procedure}`,
            parameters: raw.inputSchema as Record<string, unknown> | undefined,
          };
        } catch (err) {
          console.warn(`[registry-backend] Failed to fetch tool info for '${mcpName}': ${err}`);
          return null;
        }
      }),
    );

    for (const info of results) {
      if (info !== null) {
        toolInfos.push(info);
      }
    }
  }

  const providerCount = new Set(toolInfos.map((t) => t.namespace)).size;
  console.log(
    `[registry-backend] Loaded ${toolInfos.length} tools from ${providerCount} provider(s)`,
  );

  return toolInfos;
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/**
 * Create a `RegistryBackend` that routes widget service calls through the
 * Aprovan Registry MCP server.
 *
 * The Registry server is spawned as a child process via stdio. All current
 * `process.env` variables (including provider credentials such as `GITHUB_TOKEN`)
 * are forwarded to the child process, with `UTDK_PROVIDERS` set to the given
 * providers list. Additional overrides can be passed via `options.env`.
 *
 * @example
 * ```ts
 * const backend = await createRegistryBackend({
 *   command: "npx",
 *   args: ["@utdk/mcp-server"],
 *   providers: "github,stripe",
 * });
 *
 * const bridge = new ServiceBridge({
 *   backend,
 *   tools: backend.getToolInfos(),
 * });
 * ```
 */
export async function createRegistryBackend(
  options: RegistryBackendOptions,
): Promise<RegistryBackend> {
  // Forward the current environment so provider API keys are available in the
  // spawned process. UTDK_PROVIDERS is the only variable that must be set here.
  const inheritedEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) inheritedEnv[k] = v;
  }

  const env: Record<string, string> = {
    ...inheritedEnv,
    UTDK_PROVIDERS: options.providers,
    ...options.env,
  };

  const transport = new StdioClientTransport({
    command: options.command,
    args: options.args ?? [],
    env,
    // Route Registry stderr to the parent so operators can see provider logs.
    stderr: "inherit",
  });

  const client = new Client({
    name: "patchwork-mcp-app-server",
    version: "0.1.0",
  });

  await client.connect(transport);

  // Pre-load all tool metadata so ServiceBridge can be constructed synchronously.
  const toolInfos = await loadRegistryToolInfos(client);

  const backend: RegistryBackend = {
    /**
     * Execute a Registry-backed service tool.
     *
     * The call is forwarded as a Registry `call_tool` meta-tool invocation:
     *   namespace + "__" + procedure → Registry MCP tool name
     *
     * The first element of `args` is treated as the tool's argument object.
     */
    async call(
      namespace: string,
      procedure: string,
      args: unknown[],
    ): Promise<unknown> {
      const toolName = `${namespace}__${procedure}`;
      const toolArgs = (typeof args[0] === "object" && args[0] !== null ? args[0] : {}) as Record<
        string,
        unknown
      >;

      const result = (await client.callTool({
        name: "call_tool",
        arguments: {
          tool_name: toolName,
          arguments: toolArgs,
        },
      })) as McpToolResult;

      if (result.isError) {
        const message = result.content
          .filter((c): c is { type: "text"; text: string } => c.type === "text")
          .map((c) => c.text)
          .join("\n");
        throw new Error(message || `Registry call failed for '${toolName}'`);
      }

      // Return parsed JSON when the response looks like JSON, else return raw text.
      const textContent = result.content.find(
        (c): c is { type: "text"; text: string } => c.type === "text",
      );
      if (textContent) {
        try {
          return JSON.parse(textContent.text) as unknown;
        } catch {
          return textContent.text;
        }
      }

      return result;
    },

    getToolInfos(): ServiceToolInfo[] {
      return toolInfos;
    },

    async close(): Promise<void> {
      await client.close();
    },
  };

  return backend;
}
