import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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

/**
 * Cross-process coordination for the shared widget host.
 *
 * Every stdio spawn of this server (Claude Desktop respawns it freely) would
 * otherwise start its own widget server and its own cloudflared quick tunnel.
 * Only one can bind {@link WIDGET_PORT}; the rest orphan extra tunnels and, worse,
 * each render returns a *different* hostname — and any instance whose ephemeral
 * tunnel has dropped serves a dead URL (Cloudflare 1033) into the widget HTML.
 *
 * We elect a single owner via the port bind: whoever binds the port establishes
 * (and verifies) the tunnel and publishes its base URL to a temp file keyed by
 * port; every other instance reuses that URL instead of starting a tunnel.
 */
interface WidgetHostState {
  baseUrl: string;
  pid: number;
  updatedAt: number;
}

const WIDGET_STATE_FILE = join(tmpdir(), `patchwork-widget-${WIDGET_PORT}.json`);

function readWidgetHostState(): WidgetHostState | null {
  try {
    return JSON.parse(readFileSync(WIDGET_STATE_FILE, "utf8")) as WidgetHostState;
  } catch {
    return null;
  }
}

function publishWidgetHostState(baseUrl: string): void {
  try {
    const state: WidgetHostState = { baseUrl, pid: process.pid, updatedAt: Date.now() };
    writeFileSync(WIDGET_STATE_FILE, JSON.stringify(state));
  } catch (err) {
    error("mcp-app-server", "Failed to publish widget host state:", err);
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // ESRCH = no such process; EPERM = exists but not ours (still alive).
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Wait for the owning instance to publish its (verified) base URL. Only adopt
 * state whose owning pid is still alive, so a non-owner never reuses a dead
 * previous owner's (now-1033) hostname.
 */
async function awaitPublishedWidgetBaseUrl(timeoutMs = 35000): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = readWidgetHostState();
    if (state?.baseUrl && isProcessAlive(state.pid)) return state.baseUrl;
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

/** Locate a built browser bundle dir (dist/<name>) from either dist or src. */
function resolveDistDir(name: string): string {
  const candidates = [
    fileURLToPath(new URL(`./${name}`, import.meta.url)), // built: dist/<name>
    fileURLToPath(new URL(`../dist/${name}`, import.meta.url)), // dev via tsx: src → dist
  ];
  return candidates.find((dir) => existsSync(dir)) ?? candidates[0]!;
}

/** Locate the built runtime bundle (dist/runtime). */
export function resolveRuntimeDir(): string {
  return resolveDistDir("runtime");
}

/** Locate the built MCP App shell bundle (dist/shell). */
export function resolveShellDir(): string {
  return resolveDistDir("shell");
}

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

  // Serve the MCP App shell (resource document's external script) and the shared
  // browser runtime bundle (compiles widgets in-browser). Both resolve to dist
  // whether running built (dist/server.js) or via tsx (src).
  widgetApp.use("/shell", express.static(resolveShellDir()));
  widgetApp.use("/runtime", express.static(resolveRuntimeDir()));

  // Raw widget source files — fetched by the runtime and compiled in-browser.
  widgetApp.get("/widget/:name/:hash/files", async (req, res) => {
    const { name, hash } = req.params;
    try {
      const widget = await store.getWidget(name, hash);
      if (!widget) {
        res.status(404).json({ error: "Widget not found" });
        return;
      }
      res.json({ files: widget.files, entry: widget.entry, manifest: widget.manifest });
    } catch (err) {
      error("widget-server", "Error serving widget files:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Convenience redirect: /widget/:name/:hash → runtime host with the widget preselected.
  widgetApp.get("/widget/:name/:hash", (req, res) => {
    const { name, hash } = req.params;
    res.redirect(
      302,
      `/runtime/?widget=${encodeURIComponent(name)}/${encodeURIComponent(hash)}`,
    );
  });

  widgetApp.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "patchwork-widget-server" });
  });

  // Elect the widget-host owner via the port bind. A failed bind (EADDRINUSE)
  // means another instance already owns the widget server + tunnel.
  const isOwner = await new Promise<boolean>((resolve) => {
    const httpServer = widgetApp.listen(WIDGET_PORT, HOST, () => {
      log("mcp-app-server", `Widget server listening on http://${HOST}:${WIDGET_PORT}`);
      resolve(true);
    });
    httpServer.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        log(
          "mcp-app-server",
          `Widget port ${WIDGET_PORT} already owned by another instance; reusing its widget host.`,
        );
      } else {
        error("mcp-app-server", "Widget server failed to bind:", err);
      }
      resolve(false);
    });
  });

  if (!isOwner) {
    // Reuse the owner's verified, published base URL so every instance hands out
    // the same live hostname instead of orphaning another (possibly dead) tunnel.
    const shared = await awaitPublishedWidgetBaseUrl();
    if (shared) {
      log("mcp-app-server", `Reusing shared widget host: ${shared}`);
      return shared;
    }
    error(
      "mcp-app-server",
      "Owner instance never published a base URL; falling back to localhost (widgets may not load in remote hosts).",
    );
    return `http://localhost:${WIDGET_PORT}`;
  }

  // We own the widget server. Establish (and verify) the tunnel, then publish
  // the base URL for sibling instances.
  let widgetBaseUrl = `http://localhost:${WIDGET_PORT}`;

  if (WIDGET_TUNNEL) {
    try {
      widgetBaseUrl = await startTunnel(WIDGET_PORT);
      log("mcp-app-server", `Widgets accessible at: ${widgetBaseUrl}`);
    } catch (err) {
      error("mcp-app-server", "Failed to start tunnel, using localhost:", err);
    }
  }

  publishWidgetHostState(widgetBaseUrl);
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
