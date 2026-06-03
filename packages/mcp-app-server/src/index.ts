import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server';
// tsup loader: '.html' -> 'text' inlines the file as a string at build time
import HELLO_WORLD_HTML from './hello-world.html';

const HELLO_WORLD_RESOURCE_URI = 'ui://hello-world/view.html';

/**
 * Creates and configures a new McpServer with the hello-world MCP App tool
 * and its associated HTML resource.
 *
 * Each call returns a fresh McpServer instance ready to be connected to a
 * transport.
 */
export function createMcpAppServer(): McpServer {
  const server = new McpServer({
    name: 'patchwork-mcp-app-server',
    version: '0.1.0',
  });

  registerAppTool(
    server,
    'hello_world',
    {
      description:
        'Display a hello-world widget inline in the conversation. ' +
        'Returns a static greeting card rendered as an MCP App.',
      _meta: { ui: { resourceUri: HELLO_WORLD_RESOURCE_URI } },
    },
    async () => ({
      content: [
        {
          type: 'text' as const,
          text: 'Hello, world! The widget is rendered inline above.',
        },
      ],
    }),
  );

  registerAppResource(
    server,
    'Hello World View',
    HELLO_WORLD_RESOURCE_URI,
    { description: 'Hello-world HTML widget for the Patchwork MCP App Server demo.' },
    async () => ({
      contents: [
        {
          uri: HELLO_WORLD_RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: HELLO_WORLD_HTML,
        },
      ],
    }),
  );

  return server;
}
