import cors from 'cors';
import { randomUUID } from 'node:crypto';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpAppServer, type McpAppServerOptions } from './index.js';
import { createRegistryBackend, type RegistryBackend } from './registry-backend.js';

const PORT = Number(process.env['PORT'] ?? 3000);
const HOST = process.env['HOST'] ?? '0.0.0.0';

async function startServer(): Promise<void> {
  const serverOptions: McpAppServerOptions = {};

  // ---------------------------------------------------------------------------
  // Registry auto-configuration
  //
  // Set REGISTRY_PROVIDERS to a comma-separated list of @utdk providers
  // (e.g. "github,slack,stripe") to automatically spawn the Registry MCP server
  // and make all its tools available to widgets.
  //
  // The Registry process inherits all current environment variables, so provider
  // credentials (GITHUB_TOKEN, STRIPE_SECRET_KEY, etc.) do not need to be
  // duplicated — just set them once in this process's environment.
  //
  // Optional overrides:
  //   REGISTRY_COMMAND   Executable to run (default: "npx")
  //   REGISTRY_ARGS      Space-separated extra args appended after "@utdk/mcp-server"
  // ---------------------------------------------------------------------------
  const REGISTRY_PROVIDERS = process.env['REGISTRY_PROVIDERS'];

  let registryBackend: RegistryBackend | null = null;

  if (REGISTRY_PROVIDERS) {
    const command = process.env['REGISTRY_COMMAND'] ?? 'npx';
    const extraArgs = process.env['REGISTRY_ARGS']?.split(' ').filter(Boolean) ?? [];
    const args = ['@utdk/mcp-server', ...extraArgs];

    console.log(
      `[mcp-app-server] Connecting to Registry MCP server (providers: ${REGISTRY_PROVIDERS})...`,
    );

    try {
      registryBackend = await createRegistryBackend({
        command,
        args,
        providers: REGISTRY_PROVIDERS,
      });

      const toolInfos = registryBackend.getToolInfos();
      serverOptions.services = {
        backend: registryBackend,
        tools: toolInfos,
      };

      const namespaces = [...new Set(toolInfos.map((t) => t.namespace))];
      console.log(
        `[mcp-app-server] Registry ready: ${toolInfos.length} tools across namespaces: ${namespaces.join(', ')}`,
      );
    } catch (err) {
      console.error('[mcp-app-server] Failed to connect to Registry MCP server:', err);
      console.error('[mcp-app-server] Starting without Registry service backend.');
    }
  }

  const app = createMcpExpressApp({ host: HOST });

  // Allow cross-origin requests so Claude web (behind cloudflared) can reach the server
  app.use(cors());

  /**
   * MCP endpoint — stateless mode.
   *
   * Each HTTP request gets its own McpServer + StreamableHTTPServerTransport pair.
   * The underlying Registry connection (registryBackend) is long-lived and shared.
   */
  app.all('/mcp', async (req, res) => {
    const mcpServer = createMcpAppServer(serverOptions);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });

    // Clean up when the response finishes
    res.on('close', () => {
      void mcpServer.close();
    });

    try {
      await mcpServer.connect(transport);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('[mcp] request error', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  });

  /** Health-check endpoint — useful for cloudflared and load-balancer probes. */
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'patchwork-mcp-app-server' });
  });

  app.listen(PORT, HOST, () => {
    console.log(`MCP App Server listening on http://${HOST}:${PORT}`);
    console.log(`  POST /mcp    — MCP Streamable HTTP endpoint`);
    console.log(`  GET  /health — health check`);
    console.log();
    console.log('To expose locally via cloudflared:');
    console.log(`  cloudflared tunnel --url http://localhost:${PORT}`);
  });

  // Clean up the Registry child process on shutdown.
  const shutdown = () => {
    if (registryBackend) {
      registryBackend.close().catch(() => {/* ignore close errors on exit */});
    }
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

startServer().catch((err: unknown) => {
  console.error('[mcp-app-server] Fatal startup error:', err);
  process.exit(1);
});
