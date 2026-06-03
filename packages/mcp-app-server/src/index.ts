import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import {
  createProjectFromFiles,
  type Manifest,
  type VirtualFile,
  type VirtualProject,
} from "@aprovan/patchwork-compiler";
import {
  compileWidget,
  allEntries,
  type CompileWidgetResult,
} from "./compiler/index.js";
import HELLO_WORLD_HTML from "./hello-world.html";

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

function registerWidgetResources(server: McpServer): void {
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

export function createMcpAppServer(): McpServer {
  const server = new McpServer({
    name: "patchwork-mcp-app-server",
    version: "0.1.0",
  });

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
        "The compiled widget is cached and served at the returned resource URI.",
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

      const manifestInput: Record<string, unknown> = {};
      if (args?.["name"]) manifestInput["name"] = args["name"];
      if (args?.["image"]) manifestInput["image"] = args["image"];

      const manifest = buildManifest(manifestInput);
      const project = buildVirtualProject(source, files, entry);

      try {
        const result: CompileWidgetResult = await compileWidget(project, manifest);

        registerAppResource(
          server,
          `Widget ${manifest.name}`,
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
              text: `Widget compiled successfully. View it at: ${result.resourceUri}`,
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

  registerWidgetResources(server);

  return server;
}
