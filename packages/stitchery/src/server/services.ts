/**
 * Service Registry - Tracks available services for widget calls
 *
 * Services can be registered from:
 * - MCP servers (via --mcp CLI)
 * - External backends (UTCP, HTTP, etc.)
 *
 * Provides unified interface for calling services and exposing metadata.
 */

import { jsonSchema, type Tool } from 'ai';

/**
 * Service backend interface - abstracts service call mechanisms
 * Backends can be UTCP, HTTP proxies, direct MCP, etc.
 */
export interface ServiceBackend {
  call(service: string, procedure: string, args: unknown[]): Promise<unknown>;
}

/**
 * Service tool metadata for prompt generation
 */
export interface ServiceToolInfo {
  /** Full tool name (e.g., 'weather.get_forecast') */
  name: string;
  /** Namespace (e.g., 'weather') */
  namespace: string;
  /** Procedure name (e.g., 'get_forecast') */
  procedure: string;
  /** Tool description */
  description?: string;
  /** Parameter schema */
  parameters?: Record<string, unknown>;
  /** TypeScript interface definition (optional, for search results) */
  typescriptInterface?: string;
}

/**
 * Search options for tool discovery
 */
export interface SearchServicesOptions {
  /** Natural language task description to search for */
  query?: string;
  /** Filter by namespace */
  namespace?: string;
  /** Maximum results to return */
  limit?: number;
  /** Include full TypeScript interfaces in results */
  includeInterfaces?: boolean;
}

/**
 * Service registry that tracks available services
 */
export class ServiceRegistry {
  private tools: Map<string, Tool> = new Map();
  private toolInfo: Map<string, ServiceToolInfo> = new Map();
  private backends: ServiceBackend[] = [];

  /**
   * Register tools from MCP or other sources
   * @param tools - Record of tool name to Tool
   * @param namespace - Optional namespace to prefix all tools (e.g., MCP server name)
   */
  registerTools(tools: Record<string, Tool>, namespace?: string): void {
    for (const [toolName, tool] of Object.entries(tools)) {
      // Build the full name: namespace.toolName or just toolName
      const name = namespace ? `${namespace}.${toolName}` : toolName;
      this.tools.set(name, tool);

      // Parse namespace and procedure from the full name using '.' separator
      const dotIndex = name.indexOf('.');
      const ns = dotIndex > 0 ? name.substring(0, dotIndex) : name;
      const procedure = dotIndex > 0 ? name.substring(dotIndex + 1) : name;

      this.toolInfo.set(name, {
        name,
        namespace: ns,
        procedure,
        description: tool.description,
        parameters: (tool.inputSchema ?? {}) as Record<string, unknown>,
        typescriptInterface: this.generateTypeScriptInterface(name, tool),
      });
    }
  }

  /**
   * Register a service backend (UTCP, HTTP, etc.)
   * Creates callable Tool objects for each procedure so the LLM can invoke them directly.
   * Backends are tried in order of registration, first success wins.
   */
  registerBackend(
    backend: ServiceBackend,
    toolInfos?: ServiceToolInfo[],
  ): void {
    this.backends.push(backend);
    if (toolInfos) {
      for (const info of toolInfos) {
        this.toolInfo.set(info.name, info);

        // Create a callable Tool object for LLM use
        const tool: Tool = {
          description: info.description,
          inputSchema: jsonSchema(
            info.parameters ?? { type: 'object', properties: {} },
          ),
          execute: async (args: unknown) => {
            return backend.call(info.namespace, info.procedure, [args]);
          },
        };
        this.tools.set(info.name, tool);
      }
    }
  }

  /**
   * Generate TypeScript interface from tool schema
   */
  private generateTypeScriptInterface(name: string, tool: Tool): string {
    const schema = tool.inputSchema as Record<string, unknown> | undefined;
    const props = (schema?.properties ?? {}) as Record<
      string,
      { type?: string; description?: string }
    >;
    const required = (schema?.required ?? []) as string[];

    const params = Object.entries(props)
      .map(([key, val]) => {
        const optional = !required.includes(key) ? '?' : '';
        const type =
          val.type === 'number'
            ? 'number'
            : val.type === 'boolean'
            ? 'boolean'
            : val.type === 'array'
            ? 'unknown[]'
            : val.type === 'object'
            ? 'Record<string, unknown>'
            : 'string';
        const comment = val.description ? ` // ${val.description}` : '';
        return `  ${key}${optional}: ${type};${comment}`;
      })
      .join('\n');

    return `interface ${name.replace(
      /[^a-zA-Z0-9]/g,
      '_',
    )}Args {\n${params}\n}`;
  }

  /**
   * Convert internal tool name (namespace.procedure) to LLM-safe name (namespace_procedure)
   * OpenAI-compatible APIs require tool names to match ^[a-zA-Z0-9_-]+$
   */
  private toLLMToolName(internalName: string): string {
    return internalName.replace(/\./g, '_');
  }

  /**
   * Convert LLM tool name (namespace_procedure) back to internal name (namespace.procedure)
   * Only converts the first underscore after the namespace prefix
   */
  private fromLLMToolName(llmName: string): string {
    // Find the tool by checking if any registered tool converts to this LLM name
    for (const internalName of this.tools.keys()) {
      if (this.toLLMToolName(internalName) === llmName) {
        return internalName;
      }
    }
    // Fallback: convert first underscore to dot
    const underscoreIndex = llmName.indexOf('_');
    if (underscoreIndex > 0) {
      return (
        llmName.substring(0, underscoreIndex) +
        '.' +
        llmName.substring(underscoreIndex + 1)
      );
    }
    return llmName;
  }

  /**
   * Get all tools for LLM usage with LLM-safe names (underscores instead of dots)
   */
  getTools(): Record<string, Tool> {
    const result: Record<string, Tool> = {};
    for (const [name, tool] of this.tools) {
      result[this.toLLMToolName(name)] = tool;
    }
    return result;
  }

  /**
   * Get service metadata for prompt generation
   */
  getServiceInfo(): ServiceToolInfo[] {
    return Array.from(this.toolInfo.values());
  }

  /**
   * Get unique namespaces
   */
  getNamespaces(): string[] {
    const namespaces = new Set<string>();
    for (const info of this.toolInfo.values()) {
      namespaces.add(info.namespace);
    }
    return Array.from(namespaces);
  }

  /**
   * Search for services by query, namespace, or list all
   */
  searchServices(options: SearchServicesOptions = {}): ServiceToolInfo[] {
    const { query, namespace, limit = 20, includeInterfaces = false } = options;

    let results = Array.from(this.toolInfo.values());

    // Filter by namespace
    if (namespace) {
      results = results.filter((info) => info.namespace === namespace);
    }

    // Search by query (simple keyword matching)
    if (query) {
      const queryLower = query.toLowerCase();
      const keywords = queryLower.split(/\s+/).filter(Boolean);

      results = results
        .map((info) => {
          const searchText = `${info.name} ${info.namespace} ${
            info.procedure
          } ${info.description ?? ''}`.toLowerCase();
          const matchCount = keywords.filter((kw) =>
            searchText.includes(kw),
          ).length;
          return { info, score: matchCount / keywords.length };
        })
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score)
        .map(({ info }) => info);
    }

    // Apply limit
    results = results.slice(0, limit);

    // Optionally include TypeScript interfaces
    if (!includeInterfaces) {
      results = results.map(({ typescriptInterface: _, ...rest }) => rest);
    }

    return results;
  }

  /**
   * Get detailed info about a specific tool
   */
  getToolInfo(toolName: string): ServiceToolInfo | undefined {
    return this.toolInfo.get(toolName);
  }

  /**
   * List all tool names
   */
  listToolNames(): string[] {
    return Array.from(this.toolInfo.keys());
  }

  /**
   * Call a service procedure
   */
  async call(
    namespace: string,
    procedure: string,
    args: unknown,
  ): Promise<unknown> {
    // Try registered backends first (in order)
    for (const backend of this.backends) {
      try {
        return await backend.call(namespace, procedure, [args]);
      } catch {
        // Try next backend
      }
    }

    // Fall back to MCP tools - use dot separator
    const exactKey = `${namespace}.${procedure}`;
    let tool = this.tools.get(exactKey);

    if (!tool) {
      // Try finding by namespace prefix match
      for (const [name, t] of this.tools) {
        if (name.startsWith(`${namespace}.`) && name.endsWith(procedure)) {
          tool = t;
          break;
        }
      }
    }

    if (!tool) {
      throw new Error(
        `Service not found: ${namespace}.${procedure}. Available: ${Array.from(
          this.tools.keys(),
        )
          .slice(0, 10)
          .join(', ')}`,
      );
    }

    // Execute the tool
    if (!tool.execute) {
      throw new Error(`Tool ${namespace}.${procedure} has no execute function`);
    }

    const result = await tool.execute(args as Record<string, unknown>, {
      toolCallId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      messages: [],
    });

    return result;
  }

  /**
   * Check if a service exists
   */
  has(namespace: string, procedure: string): boolean {
    const key = `${namespace}.${procedure}`;
    return this.tools.has(key);
  }

  /**
   * Get count of registered tools
   */
  get size(): number {
    return this.toolInfo.size;
  }
}

/**
 * Generate a services description for prompts
 */
export function generateServicesPrompt(registry: ServiceRegistry): string {
  const namespaces = registry.getNamespaces();
  if (namespaces.length === 0) return '';

  const services = registry.getServiceInfo();
  const byNamespace = new Map<string, ServiceToolInfo[]>();

  for (const service of services) {
    const existing = byNamespace.get(service.namespace) || [];
    existing.push(service);
    byNamespace.set(service.namespace, existing);
  }

  let prompt = `## Available Services\n\nThe following services are available for generated widgets to call:\n\n`;

  for (const [ns, tools] of byNamespace) {
    prompt += `### \`${ns}\`\n`;
    for (const tool of tools) {
      prompt += `- \`${ns}.${tool.procedure}()\``;
      if (tool.description) {
        prompt += `: ${tool.description}`;
      }
      prompt += '\n';
    }
    prompt += '\n';
  }

  prompt += `**Usage in widgets:**
\`\`\`tsx
// Services are available as global namespaces
const result = await ${namespaces[0] ?? 'service'}.${
    byNamespace.get(namespaces[0] ?? '')?.[0]?.procedure ?? 'example'
  }({ /* args */ });
\`\`\`

Make sure to handle loading states and errors when calling services.
`;

  return prompt;
}
