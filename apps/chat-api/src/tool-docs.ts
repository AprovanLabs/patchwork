export interface ToolInfo {
  namespace: string;
  name: string;
  description?: string;
}

export interface GatewayClient {
  listTools(): Promise<ToolInfo[]>;
}

// Module-scope cache — 60 s TTL, survives Lambda warm invocations
let _cachedToolDocs = "";
let _toolDocsCachedAt = 0;
const TOOL_DOCS_TTL_MS = 60_000;

export async function getToolDocs(
  gateway: GatewayClient | null,
): Promise<string> {
  if (!gateway) return "";

  const now = Date.now();
  if (_cachedToolDocs && now - _toolDocsCachedAt < TOOL_DOCS_TTL_MS) {
    return _cachedToolDocs;
  }

  const tools = await gateway.listTools();
  _cachedToolDocs = renderToolDocs(tools);
  _toolDocsCachedAt = now;
  return _cachedToolDocs;
}

function renderToolDocs(tools: ToolInfo[]): string {
  if (tools.length === 0) return "";

  const byNamespace = new Map<string, ToolInfo[]>();
  for (const tool of tools) {
    const existing = byNamespace.get(tool.namespace) ?? [];
    existing.push(tool);
    byNamespace.set(tool.namespace, existing);
  }

  const namespaces = [...byNamespace.keys()];
  let doc = `## Services\n\nThe following services are available for generated widgets to call:\n\n`;

  for (const [ns, nsTools] of byNamespace) {
    doc += `### \`${ns}\`\n`;
    for (const tool of nsTools) {
      doc += `- \`${ns}.${tool.name}()\``;
      if (tool.description) doc += `: ${tool.description}`;
      doc += "\n";
    }
    doc += "\n";
  }

  const firstNs = namespaces[0] ?? "service";
  const firstTool = byNamespace.get(firstNs)?.[0]?.name ?? "example";
  doc += `**Usage in widgets:**
\`\`\`tsx
// Services are available as global namespaces
const result = await ${firstNs}.${firstTool}({ /* args */ });
\`\`\`

Make sure to handle loading states and errors when calling services.
`;

  return doc;
}

export function makeHttpGatewayClient(gatewayUrl: string): GatewayClient {
  return {
    async listTools(): Promise<ToolInfo[]> {
      const res = await fetch(`${gatewayUrl}/tools`);
      if (!res.ok) throw new Error(`Gateway returned ${res.status}`);
      return res.json() as Promise<ToolInfo[]>;
    },
  };
}
