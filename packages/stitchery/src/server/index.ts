import { createServer, type Server } from "node:http";
import { createMCPClient } from "@ai-sdk/mcp";
import { Experimental_StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import { createUtcpBackend } from "@aprovan/patchwork-utcp";
import { jsonSchema, type Tool } from "ai";
import type { ServerConfig, McpServerConfig } from "../types.js";
import { handleChat, handleEdit, type RouteContext } from "./routes.js";
import { handleLocalPackages } from "./local-packages.js";
import { handleVFS, type VFSContext } from "./vfs-routes.js";
import { ServiceRegistry, generateServicesPrompt } from "./services.js";
import {
  createUnifiedContext,
  publishServiceCall,
  publishGitHubWebhook,
  type UnifiedContext,
} from "./unified.js";

export interface StitcheryServer {
  server: Server;
  registry: ServiceRegistry;
  unified?: UnifiedContext;
  start(): Promise<{ port: number; host: string }>;
  stop(): Promise<void>;
}

async function initMcpTools(
  configs: McpServerConfig[],
  registry: ServiceRegistry,
): Promise<void> {
  for (const config of configs) {
    const client = await createMCPClient({
      transport: new Experimental_StdioMCPTransport({
        command: config.command,
        args: config.args,
      }),
    });
    // Use MCP server name as namespace for all tools from this server
    registry.registerTools(await client.tools(), config.name);
  }
}

const searchServicesSchema = {
  type: "object",
  properties: {
    query: {
      type: "string",
      description:
        'Natural language description of what you want to do (e.g., "get weather forecast", "list github repos")',
    },
    namespace: {
      type: "string",
      description:
        'Filter results to a specific service namespace (e.g., "weather", "github")',
    },
    tool_name: {
      type: "string",
      description: "Get detailed info about a specific tool by name",
    },
    limit: {
      type: "number",
      description: "Maximum number of results to return",
      default: 10,
    },
    include_interfaces: {
      type: "boolean",
      description: "Include TypeScript interface definitions in results",
      default: true,
    },
  },
} as const;

interface SearchServicesArgs {
  query?: string;
  namespace?: string;
  tool_name?: string;
  limit?: number;
  include_interfaces?: boolean;
}

/**
 * Create the search_services tool for LLM use
 */
function createSearchServicesTool(registry: ServiceRegistry): Tool {
  return {
    description: `Search for available services/tools. Use this to discover what APIs are available for widgets to call.

Returns matching services with their TypeScript interfaces. Use when:
- You need to find a service to accomplish a task
- You want to explore available APIs in a namespace
- You need the exact interface/parameters for a service call`,
    inputSchema: jsonSchema<SearchServicesArgs>(searchServicesSchema),
    execute: async (args: SearchServicesArgs) => {
      // If requesting specific tool info
      if (args.tool_name) {
        const info = registry.getToolInfo(args.tool_name);
        if (!info) {
          return {
            success: false,
            error: `Tool '${args.tool_name}' not found`,
          };
        }
        return { success: true, tool: info };
      }

      // Search for tools
      const results = registry.searchServices({
        query: args.query,
        namespace: args.namespace,
        limit: args.limit ?? 10,
        includeInterfaces: args.include_interfaces ?? true,
      });

      return {
        success: true,
        count: results.length,
        tools: results,
        namespaces: registry.getNamespaces(),
      };
    },
  };
}

function parseBody<T>(req: import("node:http").IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

export async function createStitcheryServer(
  config: Partial<ServerConfig> = {},
): Promise<StitcheryServer> {
  const {
    port = 6434,
    host = "127.0.0.1",
    copilotProxyUrl = "http://127.0.0.1:6433/v1",
    localPackages = {},
    mcpServers = [],
    utcp,
    vfsDir,
    vfsUsePaths = false,
    dataDir,
    skillsDir,
    enableEvents = false,
    enableOrchestrator = false,
    verbose = false,
  } = config;

  const log = verbose
    ? (...args: unknown[]) => console.log("[stitchery]", ...args)
    : () => {};

  // Create service registry
  const registry = new ServiceRegistry();

  // Initialize unified context if enabled
  let unified: UnifiedContext | undefined;
  if (enableEvents && dataDir) {
    log("Initializing unified event system...");
    try {
      unified = await createUnifiedContext({
        dataDir,
        skillsDir,
        enableOrchestrator,
      });
      log("Unified context initialized");
      if (skillsDir) {
        log(`Skills loaded from: ${skillsDir}`);
      }
    } catch (err) {
      console.error("[stitchery] Failed to initialize unified context:", err);
    }
  }

  log("Initializing MCP tools...");
  await initMcpTools(mcpServers, registry);
  log(`Loaded ${registry.size} tools from ${mcpServers.length} MCP servers`);

  // Initialize UTCP backend if config provided
  if (utcp) {
    log("Initializing UTCP backend...");
    log("UTCP config:", JSON.stringify(utcp, null, 2));
    try {
      // Cast to unknown since createUtcpBackend uses UtcpClientConfigSerializer to validate
      const { backend, toolInfos } = await createUtcpBackend(
        utcp as unknown as Parameters<typeof createUtcpBackend>[0],
        utcp.cwd,
      );
      registry.registerBackend(backend, toolInfos);
      log(
        `Registered UTCP backend with ${toolInfos.length} tools:`,
        toolInfos.map((tool: { name: string }) => tool.name).join(", "),
      );
    } catch (err) {
      console.error("[stitchery] Failed to initialize UTCP backend:", err);
    }
  }

  log("Local packages:", localPackages);

  // Create internal tools (search_services, etc.)
  const internalTools = {
    search_services: createSearchServicesTool(registry),
  };

  // Combine MCP tools with internal tools
  const allTools = { ...registry.getTools(), ...internalTools };

  const routeCtx: RouteContext = {
    copilotProxyUrl,
    tools: allTools,
    registry,
    servicesPrompt: generateServicesPrompt(registry),
    log,
    unified,
  };

  const localPkgCtx = { localPackages, log };

  const vfsCtx: VFSContext | null = vfsDir
    ? { rootDir: vfsDir, usePaths: vfsUsePaths, log }
    : null;

  const server = createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, DELETE, HEAD, OPTIONS",
    );
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization",
    );

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = req.url || "/";
    log(`${req.method} ${url}`);

    try {
      if (handleLocalPackages(req, res, localPkgCtx)) {
        return;
      }

      if (vfsCtx && handleVFS(req, res, vfsCtx)) {
        return;
      }

      if (url === "/api/chat" && req.method === "POST") {
        await handleChat(req, res, routeCtx);
        return;
      }

      if (url === "/api/edit" && req.method === "POST") {
        await handleEdit(req, res, routeCtx);
        return;
      }

      // Service proxy endpoint for widgets
      const proxyMatch = url.match(/^\/api\/proxy\/([^/]+)\/(.+)$/);
      if (proxyMatch && req.method === "POST") {
        const [, namespace, procedure] = proxyMatch;
        const startTime = Date.now();
        try {
          const body = await parseBody<{ args?: unknown }>(req);
          const result = await registry.call(
            namespace!,
            procedure!,
            body.args ?? {},
          );

          if (unified) {
            await publishServiceCall(
              unified.eventBus,
              namespace!,
              procedure!,
              body.args,
              result,
              Date.now() - startTime
            );
          }

          res.setHeader("Content-Type", "application/json");
          res.writeHead(200);
          res.end(JSON.stringify(result));
        } catch (err) {
          log("Proxy error:", err);

          if (unified) {
            await publishServiceCall(
              unified.eventBus,
              namespace!,
              procedure!,
              {},
              null,
              Date.now() - startTime,
              err instanceof Error ? err.message : "Service call failed"
            );
          }

          res.setHeader("Content-Type", "application/json");
          res.writeHead(500);
          res.end(
            JSON.stringify({
              error: err instanceof Error ? err.message : "Service call failed",
            }),
          );
        }
        return;
      }

      // GitHub webhook endpoint
      if (url === "/webhooks/github" && req.method === "POST") {
        if (!unified) {
          res.writeHead(503);
          res.end("Event system not enabled");
          return;
        }
        try {
          const payload = await parseBody<Record<string, unknown>>(req);
          const event = req.headers["x-github-event"] as string;
          const delivery = req.headers["x-github-delivery"] as string | undefined;
          await publishGitHubWebhook(unified.eventBus, event, payload, delivery);
          log(`GitHub webhook: ${event}`);
          res.writeHead(200);
          res.end("OK");
        } catch (err) {
          log("Webhook error:", err);
          res.writeHead(500);
          res.end(err instanceof Error ? err.message : "Webhook processing failed");
        }
        return;
      }

      // Event query endpoint
      if (url === "/api/events" && req.method === "POST") {
        if (!unified) {
          res.writeHead(503);
          res.end(JSON.stringify({ error: "Event system not enabled" }));
          return;
        }
        try {
          const body = await parseBody<{
            types?: string[];
            subjects?: string[];
            since?: string;
            limit?: number;
          }>(req);
          const events = await unified.eventBus.query(
            { types: body.types, subjects: body.subjects, since: body.since },
            { limit: body.limit ?? 100 }
          );
          res.setHeader("Content-Type", "application/json");
          res.writeHead(200);
          res.end(JSON.stringify(events));
        } catch (err) {
          log("Event query error:", err);
          res.writeHead(500);
          res.end(JSON.stringify({ error: String(err) }));
        }
        return;
      }

      // Services search endpoint (POST with body for complex queries)
      if (url === "/api/services/search" && req.method === "POST") {
        const body = await parseBody<{
          query?: string;
          namespace?: string;
          tool_name?: string;
          limit?: number;
          include_interfaces?: boolean;
        }>(req);

        res.setHeader("Content-Type", "application/json");
        res.writeHead(200);

        if (body.tool_name) {
          const info = registry.getToolInfo(body.tool_name);
          if (!info) {
            res.end(
              JSON.stringify({
                success: false,
                error: `Tool '${body.tool_name}' not found`,
              }),
            );
          } else {
            res.end(JSON.stringify({ success: true, tool: info }));
          }
          return;
        }

        const results = registry.searchServices({
          query: body.query,
          namespace: body.namespace,
          limit: body.limit ?? 20,
          includeInterfaces: body.include_interfaces ?? false,
        });

        res.end(
          JSON.stringify({
            success: true,
            count: results.length,
            tools: results,
            namespaces: registry.getNamespaces(),
          }),
        );
        return;
      }

      // Services metadata endpoint
      if (url === "/api/services" && req.method === "GET") {
        res.setHeader("Content-Type", "application/json");
        res.writeHead(200);
        res.end(
          JSON.stringify({
            namespaces: registry.getNamespaces(),
            services: registry.getServiceInfo(),
          }),
        );
        return;
      }

      if (url === "/health" || url === "/") {
        res.setHeader("Content-Type", "application/json");
        res.writeHead(200);
        res.end(JSON.stringify({ status: "ok", service: "stitchery" }));
        return;
      }

      res.writeHead(404);
      res.end(`Not found: ${url}`);
    } catch (err) {
      log("Error:", err);
      res.writeHead(500);
      res.end(err instanceof Error ? err.message : "Internal server error");
    }
  });

  return {
    server,
    registry,
    unified,

    async start() {
      return new Promise((resolve, reject) => {
        server.on("error", reject);
        server.listen(port, host, () => {
          log(`Server listening on http://${host}:${port}`);
          if (unified) {
            log("Event system: enabled");
            log(`Webhooks: POST /webhooks/github`);
            log(`Events API: POST /api/events`);
          }
          resolve({ port, host });
        });
      });
    },

    async stop() {
      return new Promise((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
  };
}
