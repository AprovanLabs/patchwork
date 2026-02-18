/**
 * @aprovan/patchwork-utcp
 *
 * UTCP backend integration for Patchwork.
 * Provides a ServiceBackend implementation that routes service calls through UTCP.
 */

import '@utcp/http';
import '@utcp/text';
import '@utcp/mcp';

import {
  UtcpClient,
  ensureCorePluginsInitialized,
  UtcpClientConfigSerializer,
  UtcpClientConfig,
} from '@utcp/sdk';

import type { ServiceBackend } from '@aprovan/patchwork';

// Ensure plugins are loaded
ensureCorePluginsInitialized();

/**
 * Sanitize a string for use as a JavaScript identifier
 */
function sanitizeIdentifier(s: string): string {
  return s.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^[0-9]/, '_$&');
}

/**
 * Create a UTCP-backed ServiceBackend for patchwork
 *
 * This is the integration point between UTCP and patchwork's service system.
 * Widgets call `github.repos_list_for_user()` → patchwork routes to this backend → UTCP executes.
 *
 * @example
 * ```typescript
 * import { createUtcpBackend } from '@aprovan/patchwork-utcp';
 * import { setServiceBackend } from '@aprovan/patchwork';
 *
 * const { backend, client } = await createUtcpBackend({
 *   cwd: __dirname,
 *   manual_call_templates: [{
 *     name: 'github',
 *     call_template_type: 'http',
 *     url: 'https://raw.githubusercontent.com/.../api.github.com.json',
 *     http_method: 'GET',
 *   }],
 * });
 *
 * setServiceBackend(backend);
 *
 * // ... run widgets ...
 *
 * await client.close();
 * ```
 */
export async function createUtcpBackend(
  utcpOptions: UtcpClientConfig,
  cwd?: string,
): Promise<{
  backend: ServiceBackend;
  client: UtcpClient;
  toolInfos: Array<{
    name: string;
    namespace: string;
    procedure: string;
    description?: string;
    parameters?: Record<string, unknown>;
  }>;
}> {
  const utcpConfig = new UtcpClientConfigSerializer().validateDict(
    utcpOptions as unknown as Record<string, unknown>,
  );
  const client = await UtcpClient.create(cwd ?? process.cwd(), utcpConfig);

  // Build tool registry from discovered UTCP tools
  const toolRegistry = new Map<
    string,
    (args: Record<string, unknown>) => Promise<unknown>
  >();
  const toolInfos: Array<{
    name: string;
    namespace: string;
    procedure: string;
    description?: string;
    parameters?: Record<string, unknown>;
  }> = [];

  // Access internal getTools method - Tool has name, description, inputs, outputs, tags
  const tools = await (
    client as {
      getTools(): Promise<
        Array<{
          name: string;
          description?: string;
          inputs?: Record<string, unknown>;
        }>
      >;
    }
  )['getTools']();

  for (const tool of tools) {
    if (!tool.name.includes('.')) continue;

    const [namespace, ...parts] = tool.name.split('.');
    const sanitizedNamespace = sanitizeIdentifier(namespace!);
    let procedure = parts.map(sanitizeIdentifier).join('_');

    // Strip duplicate namespace prefix from procedure names
    // e.g., "weather_get_forecast" -> "get_forecast" when namespace is "weather"
    const namespacePrefix = `${sanitizedNamespace}_`;
    if (procedure.startsWith(namespacePrefix)) {
      procedure = procedure.slice(namespacePrefix.length);
    }

    const key = `${sanitizedNamespace}.${procedure}`;

    toolRegistry.set(key, client.callTool.bind(client, tool.name));

    toolInfos.push({
      name: key,
      namespace: sanitizedNamespace,
      procedure,
      description: tool.description,
      parameters: tool.inputs,
    });
  }

  const backend: ServiceBackend = {
    call: async (service: string, procedure: string, args: unknown[]) => {
      const key = `${service}.${procedure}`;
      const toolFn = toolRegistry.get(key);

      if (!toolFn) {
        throw new Error(
          `UTCP tool not found: ${key}. Available tools: ${Array.from(
            toolRegistry.keys(),
          )
            .slice(0, 10)
            .join(', ')}...`,
        );
      }

      return toolFn((args[0] as Record<string, unknown>) ?? {});
    },
  };

  return { backend, client, toolInfos };
}

export type { ServiceBackend };
