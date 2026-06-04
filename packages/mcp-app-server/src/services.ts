import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export interface ServiceBackend {
  call(namespace: string, procedure: string, args: unknown[]): Promise<unknown>;
}

export interface ServiceToolInfo {
  name: string;
  namespace: string;
  procedure: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export interface ServiceBridgeConfig {
  backend: ServiceBackend;
  tools: ServiceToolInfo[];
}

const TOOL_SEPARATOR = "__";

function toMcpToolName(namespace: string, procedure: string): string {
  return `${namespace}${TOOL_SEPARATOR}${procedure}`;
}

function jsonSchemaToZodShape(
  schema?: Record<string, unknown>,
): Record<string, z.ZodTypeAny> {
  const properties = (schema?.["properties"] ?? {}) as Record<
    string,
    { type?: string; description?: string }
  >;
  const required = new Set((schema?.["required"] ?? []) as string[]);

  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, prop] of Object.entries(properties)) {
    let field: z.ZodTypeAny;
    switch (prop.type) {
      case "number":
      case "integer":
        field = z.number();
        break;
      case "boolean":
        field = z.boolean();
        break;
      case "array":
        field = z.array(z.unknown());
        break;
      case "object":
        field = z.record(z.unknown());
        break;
      default:
        field = z.string();
        break;
    }
    if (prop.description) {
      field = field.describe(prop.description);
    }
    if (!required.has(key)) {
      field = field.optional();
    }
    shape[key] = field;
  }

  return shape;
}

export class ServiceBridge {
  private backend: ServiceBackend;
  private tools: Map<string, ServiceToolInfo> = new Map();

  constructor(config: ServiceBridgeConfig) {
    this.backend = config.backend;
    for (const tool of config.tools) {
      this.tools.set(tool.name, tool);
    }
  }

  registerTools(server: McpServer): void {
    for (const [, info] of this.tools) {
      const mcpToolName = toMcpToolName(info.namespace, info.procedure);
      const inputShape = jsonSchemaToZodShape(info.parameters);

      server.registerTool(
        mcpToolName,
        {
          description:
            info.description ??
            `Call ${info.namespace}.${info.procedure}`,
          inputSchema: inputShape,
        },
        async (args) => {
          try {
            const result = await this.backend.call(
              info.namespace,
              info.procedure,
              [args ?? {}],
            );
            return {
              content: [
                {
                  type: "text" as const,
                  text:
                    typeof result === "string"
                      ? result
                      : JSON.stringify(result),
                },
              ],
            };
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Service call failed: ${message}`,
                },
              ],
              isError: true,
            };
          }
        },
      );
    }
  }

  registerSearchServices(server: McpServer): void {
    server.registerTool(
      "search_services",
      {
        description:
          "Search for available service tools that widgets can call. " +
          "Returns matching services with their namespaces, procedures, and parameter schemas.",
        inputSchema: {
          query: z
            .string()
            .optional()
            .describe(
              'Natural language description of what you want to do (e.g., "get weather forecast")',
            ),
          namespace: z
            .string()
            .optional()
            .describe(
              'Filter results to a specific service namespace (e.g., "weather")',
            ),
          tool_name: z
            .string()
            .optional()
            .describe("Get detailed info about a specific tool by name"),
          limit: z
            .number()
            .optional()
            .describe("Maximum number of results to return"),
        },
      },
      async (args) => {
        const query = args?.["query"] as string | undefined;
        const namespace = args?.["namespace"] as string | undefined;
        const toolName = args?.["tool_name"] as string | undefined;
        const limit = (args?.["limit"] as number) ?? 10;

        if (toolName) {
          const dotName = toolName.replace(/__/g, ".");
          const info =
            this.tools.get(toolName) ?? this.tools.get(dotName);
          if (!info) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    success: false,
                    error: `Tool '${toolName}' not found`,
                  }),
                },
              ],
            };
          }
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ success: true, tool: info }),
              },
            ],
          };
        }

        let results = Array.from(this.tools.values());

        if (namespace) {
          results = results.filter(
            (info) => info.namespace === namespace,
          );
        }

        if (query) {
          const queryLower = query.toLowerCase();
          const keywords = queryLower.split(/\s+/).filter(Boolean);
          results = results
            .map((info) => {
              const searchText =
                `${info.name} ${info.namespace} ${info.procedure} ${info.description ?? ""}`.toLowerCase();
              const matchCount = keywords.filter((kw) =>
                searchText.includes(kw),
              ).length;
              return { info, score: matchCount / keywords.length };
            })
            .filter(({ score }) => score > 0)
            .sort((a, b) => b.score - a.score)
            .map(({ info }) => info);
        }

        results = results.slice(0, limit);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: true,
                count: results.length,
                tools: results,
                namespaces: this.getNamespaces(),
              }),
            },
          ],
        };
      },
    );
  }

  getNamespaces(): string[] {
    const namespaces = new Set<string>();
    for (const info of this.tools.values()) {
      namespaces.add(info.namespace);
    }
    return Array.from(namespaces);
  }

  getToolInfos(): ServiceToolInfo[] {
    return Array.from(this.tools.values());
  }

  has(namespace: string, procedure: string): boolean {
    return this.tools.has(`${namespace}.${procedure}`);
  }
}
