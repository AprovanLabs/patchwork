import cors from 'cors';
import { randomUUID } from 'node:crypto';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpAppServer } from './index.js';

const PORT = Number(process.env['PORT'] ?? 3000);
const HOST = process.env['HOST'] ?? '0.0.0.0';

const app = createMcpExpressApp({ host: HOST });

// Allow cross-origin requests so Claude web (behind cloudflared) can reach the server
app.use(cors());

/**
 * MCP endpoint — stateless mode.
 *
 * Each HTTP request gets its own McpServer + StreamableHTTPServerTransport pair.
 * This is the simplest correct approach for a single-tool hello-world server.
 * Swap to a session store if you need multi-turn stateful interactions.
 */
app.all('/mcp', async (req, res) => {
  const mcpServer = createMcpAppServer();
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
