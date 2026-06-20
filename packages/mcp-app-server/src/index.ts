import {
  createProjectFromFiles,
  createSingleFileProject,
  type Manifest,
  type VirtualFile,
  type VirtualProject,
} from "@aprovan/patchwork-compiler";
import {
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  subscribeSession,
  unsubscribeSession as _unsubscribeSession,
  getEvents,
  pushStreamUpdate,
  currentSeq,
  type StreamEvent,
} from "./live-update.js";
import { warn } from "./logger.js";
import {
  ServiceBridge,
  type ServiceBackend,
  type ServiceToolInfo,
  type ServiceBridgeConfig,
} from "./services.js";
import { getWidgetStore } from "./widget-store/index.js";

export type { ServiceBackend, ServiceToolInfo, ServiceBridgeConfig };
export type { StreamEvent };
export { pushStreamUpdate };

const DEFAULT_WIDGET_PORT = Number(process.env["WIDGET_PORT"] ?? 3002);
const DEFAULT_WIDGET_HOST = process.env["WIDGET_HOST"] ?? "localhost";
const DEFAULT_WIDGET_BASE_URL = `http://${DEFAULT_WIDGET_HOST}:${DEFAULT_WIDGET_PORT}`;

interface WidgetRef {
  name: string;
  hash: string;
  entry: string;
}

/**
 * Generate the MCP App resource document.
 *
 * Per the MCP Apps protocol the resource document itself must be the app that
 * connects to the host, and it runs under a strict CSP with no `unsafe-eval` —
 * so esbuild-wasm cannot run here. The resource therefore loads the bundled
 * ext-apps "shell" (served from the widget host, allow-listed via
 * `resourceDomains`) which connects to the host and embeds the CSP-free runtime
 * iframe that actually compiles the widget. The widget + inputs are passed to
 * the shell via a base64 `data-config` attribute (no inline script → CSP-safe).
 */
function generateResourceHtml(
  shellUrl: string,
  runtimeUrl: string,
  widget: WidgetRef,
  inputs: Record<string, unknown>,
): string {
  const config = JSON.stringify({
    runtime: runtimeUrl,
    widget: `${widget.name}/${widget.hash}`,
    inputs,
  });
  const configB64 = Buffer.from(config, "utf-8").toString("base64");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${widget.name}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; }
    #pw-root { width: 100%; }
  </style>
</head>
<body>
  <div id="pw-root"></div>
  <script src="${shellUrl}" data-config="${configB64}"></script>
</body>
</html>`;
}

/** Stable, non-cryptographic content hash used as the widget store key. */
function hashFiles(files: VirtualFile[], manifest: Manifest): string {
  const input = JSON.stringify({
    name: manifest.name,
    image: manifest.image,
    files: files.map((f) => [f.path, f.content]),
  });
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

const MANIFEST_DEFAULTS: Manifest = {
  name: "widget",
  version: "0.1.0",
  platform: "browser",
  image: "@aprovan/patchwork-image-shadcn",
};

/**
 * Build the CSP the host applies to the resource document.
 *
 * - `resourceDomains` (→ `script-src`) must allow the external shell bundle.
 * - `frameDomains` (→ `frame-src`) must allow the nested runtime iframe.
 *
 * Both live on the widget host origin, so a single allow-listed origin covers
 * them. Entries are scheme-qualified per the CSP spec.
 */
function buildCspConfig(
  widgetBaseUrl: string,
): { frameDomains: string[]; resourceDomains: string[] } | undefined {
  try {
    const url = new URL(widgetBaseUrl);
    // Use the exact origin (scheme + host + port). The shell bundle and the
    // nested runtime iframe both live on this single origin, so one entry covers
    // script-src (resourceDomains) and frame-src (frameDomains). Hosts enforce
    // the resource CSP strictly and drop broad wildcard hosts like
    // `https://*.trycloudflare.com`, which would leave script-src without the
    // shell origin and block the bootstrap script — so never wildcard.
    const origin = url.port
      ? `${url.protocol}//${url.hostname}:${url.port}`
      : `${url.protocol}//${url.hostname}`;
    return { frameDomains: [origin], resourceDomains: [origin] };
  } catch {
    return undefined;
  }
}

function buildManifest(input?: Record<string, unknown>): Manifest {
  return {
    name: (input?.["name"] as string) ?? MANIFEST_DEFAULTS.name,
    version: (input?.["version"] as string) ?? MANIFEST_DEFAULTS.version,
    platform: "browser",
    image: (input?.["image"] as string) ?? MANIFEST_DEFAULTS.image,
    services: input?.["services"] as string[] | undefined,
  };
}

const DEFAULT_WIDGET_SOURCE =
  "export default function Widget() { return <div>Hello Patchwork</div>; }";

function buildProject(
  name: string,
  source?: string,
  files?: Array<{ path: string; content: string }>,
  entry?: string
): VirtualProject {
  if (files && files.length > 0) {
    const virtualFiles: VirtualFile[] = files.map((f) => ({
      path: f.path,
      content: f.content,
    }));
    const project = createProjectFromFiles(virtualFiles, name);
    if (entry) project.entry = entry;
    return project;
  }
  return createSingleFileProject(source ?? DEFAULT_WIDGET_SOURCE, entry ?? "main.tsx", name);
}

export interface McpAppServerOptions {
  services?: ServiceBridgeConfig;
  /** Base URL for serving widgets (e.g., tunnel URL). Defaults to localhost:3002. */
  widgetBaseUrl?: string;
}

export function createMcpAppServer(options: McpAppServerOptions = {}): McpServer {
  const server = new McpServer({
    name: "patchwork-mcp-app-server",
    version: "0.1.0",
  });

  const serviceBridge = options.services ? new ServiceBridge(options.services) : null;
  const widgetBaseUrl = options.widgetBaseUrl ?? DEFAULT_WIDGET_BASE_URL;

  const runtimeUrl = `${widgetBaseUrl}/runtime/`;
  const shellUrl = `${widgetBaseUrl}/shell/shell.js`;
  const directUrl = (name: string, hash: string): string =>
    `${runtimeUrl}?widget=${encodeURIComponent(name)}/${encodeURIComponent(hash)}`;

  const store = getWidgetStore();

  /** Build the MCP App resource document that renders a stored widget. */
  const renderResource = (ref: WidgetRef, inputs: Record<string, unknown>) => {
    const csp = buildCspConfig(widgetBaseUrl);
    return {
      type: "resource" as const,
      resource: {
        uri: store.resourceUriFor(ref.name, ref.hash),
        mimeType: RESOURCE_MIME_TYPE,
        text: generateResourceHtml(shellUrl, runtimeUrl, ref, inputs),
        ...(csp ? { _meta: { ui: { csp } } } : {}),
      },
    };
  };

  registerAppTool(
    server,
    "save_widget",
    {
      description:
        "Save a JSX/TSX widget's raw source files for reuse and render it as an MCP App resource. " +
        "Pass source code for a single-file widget, or a files array for a multi-file project. " +
        "The widget is stored uncompiled and compiled in the browser by the shared Patchwork " +
        "runtime when rendered — pass `inputs` to supply startup props to the widget.",
      inputSchema: {
        source: z
          .string()
          .optional()
          .describe(
            "JSX/TSX source code for a single-file widget. Must export a default React component."
          ),
        files: z
          .array(
            z.object({
              path: z.string().describe("File path relative to project root (e.g. 'main.tsx')"),
              content: z.string().describe("File contents"),
            })
          )
          .optional()
          .describe(
            "Array of files for a multi-file widget project. At least one file should be the entry point (main.tsx or index.tsx)."
          ),
        entry: z
          .string()
          .optional()
          .describe("Entry point file path. Defaults to auto-detection (main.tsx, index.tsx)."),
        name: z.string().optional().describe("Widget name for the manifest. Defaults to 'widget'."),
        image: z
          .string()
          .optional()
          .describe(
            "Patchwork image package to use. Defaults to '@aprovan/patchwork-image-shadcn'."
          ),
        services: z
          .array(z.string())
          .optional()
          .describe(
            "Service namespaces the widget calls (e.g., ['weather', 'stripe']). " +
              "A proxy shim is injected so widget code can call namespace.procedure(args) directly."
          ),
        inputs: z
          .record(z.unknown())
          .optional()
          .describe("Startup props passed to the widget's default export when it is rendered."),
      },
      _meta: {
        ui: { resourceUri: "ui://widgets/{name}/{hash}/view.html" },
      },
    },
    async (args) => {
      const source = args?.["source"] as string | undefined;
      const files = args?.["files"] as Array<{ path: string; content: string }> | undefined;
      const entry = args?.["entry"] as string | undefined;
      const requestedServices = args?.["services"] as string[] | undefined;
      const inputs = (args?.["inputs"] as Record<string, unknown> | undefined) ?? {};

      const manifestInput: Record<string, unknown> = {};
      if (args?.["name"]) manifestInput["name"] = args["name"];
      if (args?.["image"]) manifestInput["image"] = args["image"];

      // Validate requested services against the connected backend.
      let services = requestedServices ?? [];
      if (services.length > 0 && serviceBridge) {
        const availableNamespaces = serviceBridge.getNamespaces();
        const unavailable = services.filter((ns) => !availableNamespaces.includes(ns));
        if (unavailable.length > 0) {
          warn(
            "mcp-app-server",
            `Requested services not available: ${unavailable.join(", ")}. Available: ${availableNamespaces.join(", ")}`
          );
        }
        services = services.filter((ns) => availableNamespaces.includes(ns));
      }
      if (services.length > 0) manifestInput["services"] = services;

      const manifest = buildManifest(manifestInput);
      const project = buildProject(manifest.name, source, files, entry);
      const projectFiles = Array.from(project.files.values());

      try {
        const hash = hashFiles(projectFiles, manifest);
        await store.saveWidget(hash, projectFiles, manifest, project.entry);

        const ref: WidgetRef = { name: manifest.name, hash, entry: project.entry };

        return {
          content: [
            renderResource(ref, inputs),
            {
              type: "text" as const,
              text:
                `Widget "${manifest.name}" saved. Hash: ${hash}\n` +
                `Compiled in-browser at: ${directUrl(manifest.name, hash)}`,
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to save widget: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  if (serviceBridge) {
    // Register search_services and call_service tools only (not individual service tools)
    // This avoids exposing hundreds of tools with names that may exceed 64 chars
    serviceBridge.registerSearchServices(server);
  }

  registerAppTool(
    server,
    "list_widgets",
    {
      description:
        "List all persisted widgets in the VFS widget store. " +
        "Returns each widget's name, version, description, path, and resource URI.",
      _meta: { ui: { resourceUri: "ui://widgets/list" } },
    },
    async () => {
      const widgets = await store.listWidgets();

      if (widgets.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No widgets stored in the VFS widget store.",
            },
          ],
        };
      }

      const lines = widgets.map((w) => {
        const parts = [`- **${w.name}** (v${w.version})`];
        if (w.description) parts.push(`  ${w.description}`);
        parts.push(`  Path: ${w.path}`);
        parts.push(`  URI: ${w.resourceUri}`);
        if (w.entry) parts.push(`  Entry: ${w.entry}`);
        if (w.services && w.services.length > 0) parts.push(`  Services: ${w.services.join(", ")}`);
        return parts.join("\n");
      });

      return {
        content: [
          {
            type: "text" as const,
            text: `Stored widgets (${widgets.length}):\n\n${lines.join("\n\n")}`,
          },
        ],
      };
    }
  );

  registerAppTool(
    server,
    "render_widget",
    {
      description:
        "Render a persisted widget by its name and hash. " +
        "Serves the saved widget as an MCP App resource that compiles in the browser, " +
        "optionally supplying startup props via `inputs`.",
      inputSchema: {
        name: z.string().describe("Widget name (as stored in the VFS widget store)."),
        hash: z
          .string()
          .optional()
          .describe(
            "Widget content hash. If omitted, renders the most recent version of the named widget."
          ),
        inputs: z
          .record(z.unknown())
          .optional()
          .describe("Startup props passed to the widget's default export when it is rendered."),
      },
      _meta: {
        ui: { resourceUri: "ui://widgets/{name}/{hash}/view.html" },
      },
    },
    async (args) => {
      const name = args?.["name"] as string;
      const hashInput = args?.["hash"] as string | undefined;
      const inputs = (args?.["inputs"] as Record<string, unknown> | undefined) ?? {};

      if (!name) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Widget name is required.",
            },
          ],
          isError: true,
        };
      }

      let hash = hashInput;
      if (!hash) {
        const widgets = await store.listWidgets();
        const match = widgets.find((w) => w.name === name);
        if (!match) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No stored widget found with name "${name}".`,
              },
            ],
            isError: true,
          };
        }
        const resourcePath = match.resourceUri
          .replace("ui://widgets/", "")
          .replace("/view.html", "");
        const parts = resourcePath.split("/");
        hash = parts[1] ?? parts[0] ?? "";
      }

      if (!hash) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Could not determine hash for widget "${name}".`,
            },
          ],
          isError: true,
        };
      }

      const widget = await store.getWidget(name, hash);
      if (!widget) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Widget "${name}" with hash "${hash}" not found in the VFS store.`,
            },
          ],
          isError: true,
        };
      }

      const ref: WidgetRef = { name, hash, entry: widget.entry };

      return {
        content: [
          renderResource(ref, inputs),
          {
            type: "text" as const,
            text: `Rendered widget "${name}" (hash: ${hash}).\nCompiled in-browser at: ${directUrl(name, hash)}`,
          },
        ],
      };
    }
  );

  registerLiveUpdateTools(server);

  return server;
}

export { WidgetStore, getWidgetStore, resetWidgetStore } from "./widget-store/index.js";
export type { StoredWidget, StoredWidgetInfo, WidgetStoreOptions } from "./widget-store/types.js";

// ---------------------------------------------------------------------------
// Live-update tools
// ---------------------------------------------------------------------------

/**
 * Register the three tools that power the live-update channel:
 *
 * - `subscribe_stream`  — widget declares interest in a named data stream.
 * - `poll_updates`      — widget fetches buffered events since a given seq.
 * - `push_update`       — backend/LLM pushes new data onto a stream.
 *
 * The session ID is extracted from the MCP request's `_meta` extra or from the
 * internal `RequestHandlerExtra`. Tools that need the session ID use the
 * `extra.meta?.sessionId` field that the SDK populates from the transport.
 */
function registerLiveUpdateTools(server: McpServer): void {
  // subscribe_stream — widget registers interest in a named data stream.
  server.registerTool(
    "subscribe_stream",
    {
      description:
        "Subscribe this widget session to a named data stream. " +
        "The server will send `notifications/tools/list_changed` whenever new " +
        "events arrive; the widget should then call `poll_updates` to fetch them. " +
        "Returns the current sequence number so the widget knows where to start polling.",
      inputSchema: {
        stream: z.string().describe("Name of the data stream to subscribe to."),
        session_id: z
          .string()
          .optional()
          .describe(
            "MCP session ID. Widgets should pass the value returned in the " +
              "Mcp-Session-Id response header during initialization."
          ),
      },
    },
    (args, extra) => {
      const stream = (args as Record<string, unknown>)["stream"] as string;
      // Prefer an explicit session_id arg; fall back to the transport session
      const sessionId =
        ((args as Record<string, unknown>)["session_id"] as string | undefined) ??
        ((extra as Record<string, unknown>)["sessionId"] as string | undefined);

      if (sessionId) {
        subscribeSession(sessionId, stream);
      }

      const seq = currentSeq();
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ success: true, stream, seq }),
          },
        ],
      };
    }
  );

  // poll_updates — returns buffered events for a stream since afterSeq.
  server.registerTool(
    "poll_updates",
    {
      description:
        "Fetch buffered events for a data stream that arrived after the given " +
        "sequence number. Call this after receiving a `notifications/tools/list_changed` " +
        "notification (which the server sends when new data is available). " +
        "Pass the highest `seq` value from the last successful poll to avoid duplicates.",
      inputSchema: {
        stream: z.string().describe("Name of the data stream to poll."),
        after_seq: z
          .number()
          .int()
          .default(0)
          .describe(
            "Return only events with seq > after_seq. Pass 0 to retrieve all buffered events."
          ),
      },
    },
    (args) => {
      const stream = (args as Record<string, unknown>)["stream"] as string;
      const afterSeq = ((args as Record<string, unknown>)["after_seq"] as number) ?? 0;

      const events = getEvents(stream, afterSeq);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ success: true, stream, events }),
          },
        ],
      };
    }
  );

  // push_update — backend or LLM pushes new data onto a stream.
  server.registerTool(
    "push_update",
    {
      description:
        "Push a data update onto a named stream, broadcasting it to all " +
        "subscribed widget sessions. Subscribing widgets will receive a " +
        "`notifications/tools/list_changed` signal and then call `poll_updates` " +
        "to retrieve the new data. Use this tool from server-side code or as an " +
        "LLM tool to drive real-time widget updates.",
      inputSchema: {
        stream: z.string().describe("Name of the data stream to push to."),
        data: z
          .record(z.unknown())
          .describe("Arbitrary JSON-serialisable payload to push to subscribers."),
      },
    },
    async (args) => {
      const stream = (args as Record<string, unknown>)["stream"] as string;
      const data = (args as Record<string, unknown>)["data"];

      const seq = await pushStreamUpdate(stream, data);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ success: true, stream, seq }),
          },
        ],
      };
    }
  );
}
