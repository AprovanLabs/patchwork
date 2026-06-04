import {
  createProjectFromFiles,
  type Manifest,
  type VirtualFile,
  type VirtualProject,
} from "@aprovan/patchwork-compiler";
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  compileWidget,
  allEntries,
  type CompileWidgetResult,
} from "./compiler/index.js";
import HELLO_WORLD_HTML from "./hello-world.html";
import {
  subscribeSession,
  unsubscribeSession as _unsubscribeSession,
  getEvents,
  pushStreamUpdate,
  currentSeq,
  type StreamEvent,
} from "./live-update.js";
import {
  ServiceBridge,
  type ServiceBackend,
  type ServiceToolInfo,
  type ServiceBridgeConfig,
} from "./services.js";
import {
  type WidgetStore,
  getWidgetStore,
} from "./widget-store/index.js";

export type { ServiceBackend, ServiceToolInfo, ServiceBridgeConfig };
export type { StreamEvent };
export { pushStreamUpdate };

const HELLO_WORLD_RESOURCE_URI = "ui://hello-world/view.html";

const MANIFEST_DEFAULTS: Manifest = {
  name: "widget",
  version: "0.1.0",
  platform: "browser",
  image: "@aprovan/patchwork-image-shadcn",
};

function buildManifest(input?: Record<string, unknown>): Manifest {
  return {
    name: (input?.["name"] as string) ?? MANIFEST_DEFAULTS.name,
    version: (input?.["version"] as string) ?? MANIFEST_DEFAULTS.version,
    platform: "browser",
    image:
      (input?.["image"] as string) ?? MANIFEST_DEFAULTS.image,
    services: (input?.["services"] as string[] | undefined),
  };
}

function buildVirtualProject(
  source?: string,
  files?: Array<{ path: string; content: string }>,
  entry?: string,
): string | VirtualProject {
  if (files && files.length > 0) {
    const virtualFiles: VirtualFile[] = files.map((f) => ({
      path: f.path,
      content: f.content,
    }));
    return createProjectFromFiles(virtualFiles, entry);
  }
  return source ?? 'export default function Widget() { return <div>Hello Patchwork</div>; }';
}

async function registerStoredWidgetResources(
  server: McpServer,
  store: WidgetStore,
): Promise<void> {
  const widgets = await store.loadAll();
  for (const widget of widgets) {
    registerAppResource(
      server,
      `Widget ${widget.manifest.name}`,
      widget.resourceUri,
      {
        description: widget.manifest.description ?? `Persisted widget: ${widget.manifest.name}`,
      },
      async () => ({
        contents: [
          {
            uri: widget.resourceUri,
            mimeType: RESOURCE_MIME_TYPE,
            text: widget.html,
          },
        ],
      }),
    );
  }
}

function registerCachedWidgetResources(server: McpServer): void {
  for (const [, entry] of allEntries()) {
    registerAppResource(
      server,
      `Widget ${entry.manifest.name}`,
      entry.resourceUri,
      {
        description: entry.manifest.description ?? `Compiled widget: ${entry.manifest.name}`,
      },
      async () => ({
        contents: [
          {
            uri: entry.resourceUri,
            mimeType: RESOURCE_MIME_TYPE,
            text: entry.html,
          },
        ],
      }),
    );
  }
}

export interface McpAppServerOptions {
  services?: ServiceBridgeConfig;
}

export function createMcpAppServer(options: McpAppServerOptions = {}): McpServer {
  const server = new McpServer({
    name: "patchwork-mcp-app-server",
    version: "0.1.0",
  });

  const serviceBridge = options.services
    ? new ServiceBridge(options.services)
    : null;

  const store = getWidgetStore();

  registerAppTool(
    server,
    "hello_world",
    {
      description:
        "Display a hello-world widget inline in the conversation. " +
        "Returns a static greeting card rendered as an MCP App.",
      _meta: { ui: { resourceUri: HELLO_WORLD_RESOURCE_URI } },
    },
    async () => ({
      content: [
        {
          type: "text" as const,
          text: "Hello, world! The widget is rendered inline above.",
        },
      ],
    }),
  );

  registerAppResource(
    server,
    "Hello World View",
    HELLO_WORLD_RESOURCE_URI,
    {
      description:
        "Hello-world HTML widget for the Patchwork MCP App Server demo.",
    },
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

  registerAppTool(
    server,
    "compile_widget",
    {
      description:
        "Compile a JSX/TSX widget into a self-contained HTML page served as an MCP App resource. " +
        "Pass source code for a single-file widget, or a files array for a multi-file project. " +
        "The compiled widget is cached in memory and persisted to the VFS widget store.",
      inputSchema: {
        source: z
          .string()
          .optional()
          .describe(
            "JSX/TSX source code for a single-file widget. Must export a default React component.",
          ),
        files: z
          .array(
            z.object({
              path: z.string().describe("File path relative to project root (e.g. 'main.tsx')"),
              content: z.string().describe("File contents"),
            }),
          )
          .optional()
          .describe(
            "Array of files for a multi-file widget project. At least one file should be the entry point (main.tsx or index.tsx).",
          ),
        entry: z
          .string()
          .optional()
          .describe("Entry point file path. Defaults to auto-detection (main.tsx, index.tsx)."),
        name: z
          .string()
          .optional()
          .describe("Widget name for the manifest. Defaults to 'widget'."),
        image: z
          .string()
          .optional()
          .describe(
            "Patchwork image package to use. Defaults to '@aprovan/patchwork-image-shadcn'.",
          ),
        services: z
          .array(z.string())
          .optional()
          .describe(
            "Service namespaces the widget calls (e.g., ['weather', 'stripe']). " +
            "A proxy shim is injected so widget code can call namespace.procedure(args) directly.",
          ),
      },
      _meta: {
        ui: { resourceUri: "ui://widget/{hash}/view.html" },
      },
    },
    async (args) => {
      const source = args?.["source"] as string | undefined;
      const files = args?.["files"] as
        | Array<{ path: string; content: string }>
        | undefined;
      const entry = args?.["entry"] as string | undefined;
      const requestedServices = args?.["services"] as string[] | undefined;

      const manifestInput: Record<string, unknown> = {};
      if (args?.["name"]) manifestInput["name"] = args["name"];
      if (args?.["image"]) manifestInput["image"] = args["image"];
      if (requestedServices) manifestInput["services"] = requestedServices;

      const manifest = buildManifest(manifestInput);
      const project = buildVirtualProject(source, files, entry);

      let compileServices: string[] | undefined;
      if (requestedServices && requestedServices.length > 0 && serviceBridge) {
        const availableNamespaces = serviceBridge.getNamespaces();
        compileServices = requestedServices.filter((ns) =>
          availableNamespaces.includes(ns),
        );
        const unavailable = requestedServices.filter(
          (ns) => !availableNamespaces.includes(ns),
        );
        if (unavailable.length > 0) {
          console.warn(
            `[mcp-app-server] Requested services not available: ${unavailable.join(", ")}. Available: ${availableNamespaces.join(", ")}`,
          );
        }
      }

      try {
        const result: CompileWidgetResult = await compileWidget(
          project,
          manifest,
          compileServices ? { services: compileServices } : {},
        );

        const entryPath = typeof project === "string" ? undefined : project.entry;
        await store.saveWidget(result.hash, result.html, manifest, entryPath);

        const storedUri = store.resourceUriFor(manifest.name, result.hash);
        registerAppResource(
          server,
          `Widget ${manifest.name}`,
          storedUri,
          {
            description: manifest.description ?? `Persisted widget: ${manifest.name}`,
          },
          async () => ({
            contents: [
              {
                uri: storedUri,
                mimeType: RESOURCE_MIME_TYPE,
                text: result.html,
              },
            ],
          }),
        );

        registerAppResource(
          server,
          `Widget ${manifest.name} (cached)`,
          result.resourceUri,
          {
            description: `Compiled widget: ${manifest.name}`,
          },
          async () => ({
            contents: [
              {
                uri: result.resourceUri,
                mimeType: RESOURCE_MIME_TYPE,
                text: result.html,
              },
            ],
          }),
        );

        return {
          content: [
            {
              type: "text" as const,
              text: `Widget compiled and persisted. Resource URI: ${storedUri}`,
            },
            {
              type: "text" as const,
              text: `Cache key: ${result.hash}`,
            },
          ],
          _meta: {
            ui: { resourceUri: result.resourceUri },
          },
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `Compilation failed: ${message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  if (serviceBridge) {
    serviceBridge.registerTools(server);
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
    },
  );

  registerAppTool(
    server,
    "render_widget",
    {
      description:
        "Render a persisted widget by its name and hash. " +
        "Serves the compiled widget as an MCP App resource rendered inline in the conversation.",
      inputSchema: {
        name: z
          .string()
          .describe("Widget name (as stored in the VFS widget store)."),
        hash: z
          .string()
          .optional()
          .describe("Widget content hash. If omitted, renders the most recent version of the named widget."),
      },
      _meta: {
        ui: { resourceUri: "ui://widgets/{name}/{hash}/view.html" },
      },
    },
    async (args) => {
      const name = args?.["name"] as string;
      const hashInput = args?.["hash"] as string | undefined;

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
        const resourcePath = match.resourceUri.replace("ui://widgets/", "").replace("/view.html", "");
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

      registerAppResource(
        server,
        `Widget ${widget.manifest.name}`,
        widget.resourceUri,
        {
          description: widget.manifest.description ?? `Persisted widget: ${widget.manifest.name}`,
        },
        async () => ({
          contents: [
            {
              uri: widget.resourceUri,
              mimeType: RESOURCE_MIME_TYPE,
              text: widget.html,
            },
          ],
        }),
      );

      return {
        content: [
          {
            type: "text" as const,
            text: `Rendering widget "${name}" (hash: ${hash}).`,
          },
        ],
        _meta: {
          ui: { resourceUri: widget.resourceUri },
        },
      };
    },
  );

  registerCachedWidgetResources(server);
  void registerStoredWidgetResources(server, store);
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
            "Mcp-Session-Id response header during initialization.",
          ),
      },
    },
    (args, extra) => {
      const stream = (args as Record<string, unknown>)["stream"] as string;
      // Prefer an explicit session_id arg; fall back to the transport session
      const sessionId =
        ((args as Record<string, unknown>)["session_id"] as string | undefined) ??
        (extra as Record<string, unknown>)["sessionId"] as string | undefined;

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
    },
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
            "Return only events with seq > after_seq. Pass 0 to retrieve all buffered events.",
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
    },
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
    },
  );
}
