import { randomUUID } from "node:crypto";
import express from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import cors from "cors";
import { registerSession, unregisterSession } from "./live-update.js";
import { log, error } from "./logger.js";
import { createRegistryBackend, type RegistryBackend } from "./registry-backend.js";
import { createMcpAppServer, type McpAppServerOptions } from "./index.js";
import { getWidgetStore } from "./widget-store/index.js";
import { startTunnel, stopTunnel } from "./tunnel.js";
import type { Request, Response } from "express";

const PORT = Number(process.env["PORT"] ?? 3000);
const WIDGET_PORT = Number(process.env["WIDGET_PORT"] ?? 3002);
const HOST = process.env["HOST"] ?? "0.0.0.0";
const TRANSPORT = process.env["TRANSPORT"] ?? (process.argv.includes("--stdio") ? "stdio" : "http");
const WIDGET_TUNNEL = process.env["WIDGET_TUNNEL"] === "true" || process.argv.includes("--tunnel");

type SessionEntry = {
  server: ReturnType<typeof createMcpAppServer>;
  transport: StreamableHTTPServerTransport;
};

async function setupRegistryBackend(): Promise<{
  registryBackend: RegistryBackend | null;
  serverOptions: McpAppServerOptions;
}> {
  const REGISTRY_PROVIDERS = process.env["REGISTRY_PROVIDERS"];

  if (!REGISTRY_PROVIDERS) {
    return { registryBackend: null, serverOptions: {} };
  }

  const command = process.env["REGISTRY_COMMAND"] ?? "npx";
  const extraArgs = process.env["REGISTRY_ARGS"]?.split(" ").filter(Boolean) ?? [];
  const args = ["@utdk/mcp", ...extraArgs];

  log("mcp-app-server", `Connecting to Registry MCP server (providers: ${REGISTRY_PROVIDERS})...`);

  try {
    const registryBackend = await createRegistryBackend({
      command,
      args,
      providers: REGISTRY_PROVIDERS,
    });

    const toolInfos = registryBackend.getToolInfos();
    const namespaces = [...new Set(toolInfos.map((t) => t.namespace))];
    log(
      "mcp-app-server",
      `Registry ready: ${toolInfos.length} tools across namespaces: ${namespaces.join(", ")}`
    );

    return {
      registryBackend,
      serverOptions: {
        services: {
          backend: registryBackend,
          tools: toolInfos,
        },
      },
    };
  } catch (err) {
    error("mcp-app-server", "Failed to connect to Registry MCP server:", err);
    error("mcp-app-server", "Starting without Registry service backend.");
    return { registryBackend: null, serverOptions: {} };
  }
}

function handleExistingSession(existing: SessionEntry, req: Request, res: Response): void {
  try {
    existing.transport.handleRequest(req, res, req.body);
  } catch (err) {
    error("mcp", "session request error", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
}

async function createNewSession(
  serverOptions: McpAppServerOptions,
  sessionStore: Map<string, SessionEntry>,
  req: Request,
  res: Response
): Promise<void> {
  const mcpServer = createMcpAppServer(serverOptions);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (id) => {
      sessionStore.set(id, { server: mcpServer, transport });
      registerSession(id, mcpServer);
    },
    onsessionclosed: (id) => {
      sessionStore.delete(id);
      unregisterSession(id);
    },
  });

  res.on("close", () => {
    const id = transport.sessionId;
    if (id && !sessionStore.has(id)) {
      void mcpServer.close();
    }
  });

  try {
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    error("mcp", "new session error", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
}

function registerMcpEndpoint(
  app: ReturnType<typeof createMcpExpressApp>,
  serverOptions: McpAppServerOptions
): Map<string, SessionEntry> {
  const sessionStore = new Map<string, SessionEntry>();

  app.all("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (sessionId) {
      const existing = sessionStore.get(sessionId);
      if (existing) {
        handleExistingSession(existing, req, res);
        return;
      }
    }

    await createNewSession(serverOptions, sessionStore, req, res);
  });

  return sessionStore;
}

function registerShutdownHandlers(registryBackend: RegistryBackend | null): void {
  const shutdown = () => {
    if (registryBackend) {
      registryBackend.close().catch(() => {
        /* ignore close errors on exit */
      });
    }
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

async function startServer(): Promise<void> {
  const { registryBackend, serverOptions } = await setupRegistryBackend();

  const app = createMcpExpressApp({ host: HOST });
  app.use(cors());

  registerMcpEndpoint(app, serverOptions);

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "patchwork-mcp-app-server" });
  });

  app.listen(PORT, HOST, () => {
    log("mcp-app-server", `MCP App Server listening on http://${HOST}:${PORT}`);
    log("mcp-app-server", `  POST /mcp    — MCP Streamable HTTP endpoint (stateful sessions)`);
    log("mcp-app-server", `  GET  /health — health check`);
    log("mcp-app-server", "");
    log("mcp-app-server", "To expose locally via cloudflared:");
    log("mcp-app-server", `  cloudflared tunnel --url http://localhost:${PORT}`);
  });

  registerShutdownHandlers(registryBackend);
}

async function startWidgetServer(): Promise<string> {
  const widgetApp = express();
  widgetApp.use(cors());

  const store = getWidgetStore();

  // Serve widgets at /widget/:name/:hash
  widgetApp.get("/widget/:name/:hash", async (req, res) => {
    const { name, hash } = req.params;
    try {
      const widget = await store.getWidget(name, hash);
      if (!widget) {
        res.status(404).send("Widget not found");
        return;
      }
      res.setHeader("Content-Type", "text/html");
      res.send(widget.html);
    } catch (err) {
      error("widget-server", "Error serving widget:", err);
      res.status(500).send("Internal server error");
    }
  });

  widgetApp.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "patchwork-widget-server" });
  });

  await new Promise<void>((resolve) => {
    widgetApp.listen(WIDGET_PORT, HOST, () => {
      log("mcp-app-server", `Widget server listening on http://${HOST}:${WIDGET_PORT}`);
      resolve();
    });
  });

  // Determine the base URL for widgets
  let widgetBaseUrl = `http://localhost:${WIDGET_PORT}`;

  if (WIDGET_TUNNEL) {
    try {
      widgetBaseUrl = await startTunnel(WIDGET_PORT);
      log("mcp-app-server", `Widgets accessible at: ${widgetBaseUrl}`);
    } catch (err) {
      error("mcp-app-server", "Failed to start tunnel, using localhost:", err);
    }
  }

  return widgetBaseUrl;
}

async function startStdioServer(): Promise<void> {
  const { registryBackend, serverOptions } = await setupRegistryBackend();

  log("mcp-app-server", "Starting MCP App Server in stdio mode...");

  // Start widget server and optionally tunnel
  const widgetBaseUrl = await startWidgetServer();

  // Create MCP server with widget base URL
  const mcpServer = createMcpAppServer({
    ...serverOptions,
    widgetBaseUrl,
  });
  const transport = new StdioServerTransport();

  await mcpServer.connect(transport);

  const shutdown = () => {
    stopTunnel();
    if (registryBackend) {
      registryBackend.close().catch(() => {});
    }
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

async function main(): Promise<void> {
  if (TRANSPORT === "stdio") {
    await startStdioServer();
  } else {
    await startServer();
  }
}

main().catch((err: unknown) => {
  error("mcp-app-server", "Fatal startup error:", err);
  process.exit(1);
});
