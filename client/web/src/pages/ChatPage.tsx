import { useChat } from "@ai-sdk/react";
import { Bobbin } from '@aprovan/bobbin';
import { createCompiler, type Compiler , type VirtualProject } from "@aprovan/patchwork-compiler";
import {
  extractCodeBlocks,
  parseUsesAttribute,
  resolvePatchesInText,
  CodePreview,
  CodeBlockView,
  WidgetPreview,
  MarkdownEditor,
  EditModal,
  FileTree,
  type ServiceInfo,
} from "@aprovan/patchwork-editor";
import { DefaultChatTransport } from "ai";
import {
  Send,
  Loader2,
  Wrench,
  AlertCircle,
  Brain,
  ChevronDown,
  Minus,
  PanelLeft,
  RefreshCw,
  RotateCcw,
  X,
} from "lucide-react";
import {
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
  createContext,
  useContext,
} from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { UIMessage } from "ai";
import {
  CHAT_PROVIDERS,
  ProviderModelControls,
} from "@/components/ProviderPicker";
import {
  fetchLlmModels,
  fetchLlmProviders,
  loadModelPreference,
  saveModelPreference,
  type LlmProviderInfo,
} from "@/lib/llm";
import { AppHeader } from "@aprovan/ui/shell";
import { ServicesMenu } from "@/components/ServicesMenu";
import SessionControls from "@/components/SessionControls";
import { WorkflowFlow, isWorkflowScript } from "@/components/WorkflowFlow";
import { WorkflowsExplorer } from "@/components/WorkflowsExplorer";
import { WorkflowsMenu } from "@/components/WorkflowsMenu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getAccessTokenSync } from "@/lib/auth";
import { GATEWAY_BASE } from "@/lib/gateway";
import { gatewayFetch } from "@/lib/gateway-fetch";
import { credentialsUrl } from "@/lib/registry";
import {
  deleteWorkspacePath,
  listWorkspaceEntries,
  listWorkspacePaths,
  toWorkspaceTreeFiles,
  loadWorkspaceDirectoryProject,
  loadWorkspaceFileProject,
  createSingleWorkspaceFileProject,
  saveWorkspaceProject,
  subscribeToWorkspaceChanges,
  workspaceWidgetVfs,
  resetStore,
} from "@/lib/workspace-vfs";

const APROVAN_LOGO =
  "https://raw.githubusercontent.com/AprovanLabs/aprovan.com/main/docs/assets/social-labs.png";

interface PatchworkContext {
  compiler: Compiler | null;
  namespaces: string[];
}

const PatchworkCtx = createContext<PatchworkContext>({
  compiler: null,
  namespaces: [],
});
const useCompiler = () => useContext(PatchworkCtx).compiler;
const useServices = () => useContext(PatchworkCtx).namespaces;

function createPreviewManifest(services?: string[]) {
  return {
    name: "preview",
    version: "1.0.0",
    platform: "browser" as const,
    image: "@aprovan/patchwork-image-shadcn",
    services,
  };
}

// Workflow scripts (plain js/ts under workflows/) render as a Tailor flow
// instead of compiling as widgets — the chat's renderer for workflows, the
// way Markdown files get the Markdown renderer.
const workflowCustomPreview = ({
  code,
  filePath,
}: {
  code: string;
  filePath?: string;
}) => (isWorkflowScript(filePath, code) ? <WorkflowFlow source={code} /> : null);

const SharedEditSessionCtx = createContext<
  | ((session: {
      projectId: string;
      entryFile: string;
      filePath?: string;
      initialCode: string;
      initialProject: VirtualProject;
    }) => void)
  | null
>(null);

const useSharedEditSession = () => useContext(SharedEditSessionCtx);

function ReasoningPart({
  text,
  isStreaming,
}: {
  text: string;
  isStreaming?: boolean;
}) {
  return (
    <Collapsible defaultOpen={isStreaming}>
      <CollapsibleTrigger className="flex items-center gap-2 text-yellow-700 dark:text-yellow-400 hover:opacity-80 w-full">
        <Brain className="h-4 w-4" />
        <span className="text-xs font-medium">Thinking</span>
        {isStreaming && <Loader2 className="h-3 w-3 animate-spin" />}
        <ChevronDown className="h-3 w-3 ml-auto transition-transform [[data-state=open]>&]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 p-3 rounded border-l-4 border-yellow-500 bg-yellow-50 dark:bg-yellow-950/50">
          <p className="text-sm text-muted-foreground italic whitespace-pre-wrap">
            {text}
          </p>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ToolPart({
  toolName,
  state,
  input,
  output,
  errorText,
}: {
  toolName: string;
  state: string;
  input: unknown;
  output?: unknown;
  errorText?: string;
}) {
  const isRunning = state === "input-streaming" || state === "input-available";
  const hasError = state === "output-error";

  return (
    <Collapsible className="my-1 w-full">
      <CollapsibleTrigger className="inline-flex items-center gap-2 px-3 py-1 rounded-full border bg-muted/50 hover:bg-muted text-xs transition-colors">
        <Wrench className="h-3 w-3 text-muted-foreground" />
        <span className="font-mono">{toolName}</span>
        <span className="w-3 h-3 flex items-center justify-center">
          {isRunning && (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          )}
          {hasError && <AlertCircle className="h-3 w-3 text-destructive" />}
        </span>
        <ChevronDown className="h-3 w-3 text-muted-foreground transition-transform [[data-state=open]>&]:rotate-180" />
      </CollapsibleTrigger>

      <CollapsibleContent className="mt-2 p-3 rounded-lg border bg-card space-y-2">
        {input !== undefined && (
          <div>
            <span className="text-xs font-medium text-muted-foreground">
              Input
            </span>
            <div className="mt-1 p-2 bg-muted/30 rounded text-xs overflow-auto max-h-48">
              <pre className="whitespace-pre-wrap break-words m-0">
                {typeof input === "string"
                  ? input
                  : JSON.stringify(input, null, 2)}
              </pre>
            </div>
          </div>
        )}

        {output !== undefined && (
          <div>
            <span className="text-xs font-medium text-muted-foreground">
              Output
            </span>
            <div className="mt-1 p-2 bg-muted/30 rounded text-xs overflow-auto max-h-48">
              <pre className="whitespace-pre-wrap break-words m-0">
                {typeof output === "string"
                  ? output
                  : JSON.stringify(output, null, 2)}
              </pre>
            </div>
          </div>
        )}

        {errorText && (
          <div className="text-sm text-destructive flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span className="break-words">{errorText}</span>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

function MessageBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";
  const isStreaming = message.parts?.some(
    (p) =>
      "state" in p &&
      (p.state === "input-streaming" || p.state === "input-available"),
  );

  return (
    <div className={`flex gap-3 ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser && (
        <Avatar className="h-8 w-8 shrink-0">
          <img src={APROVAN_LOGO} alt="Assistant" className="rounded-full" />
          <AvatarFallback className="bg-primary text-primary-foreground">
            A
          </AvatarFallback>
        </Avatar>
      )}

      <div
        className={`flex flex-col gap-1 max-w-[92%] sm:max-w-[80%] min-w-0 ${
          isUser ? "items-end" : "items-start"
        }`}
      >
        <div className="flex items-center gap-2 h-5">
          <span className="text-xs text-muted-foreground capitalize">
            {message.role}
          </span>
          {isStreaming && (
            <Badge variant="outline" className="text-xs">
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              streaming
            </Badge>
          )}
        </div>

        <div
          className={`rounded-lg px-4 py-2 overflow-hidden w-full ${
            isUser ? "bg-primary text-primary-foreground" : "bg-muted"
          }`}
        >
          {message.parts?.map((part, i) => {
            if (part.type === "text") {
              return (
                <TextPartWithSession key={i} text={part.text} isUser={isUser} />
              );
            }

            if (part.type === "reasoning") {
              return (
                <ReasoningPart
                  key={i}
                  text={part.text}
                  isStreaming={part.state === "streaming"}
                />
              );
            }

            if (part.type.startsWith("tool-") || part.type === "dynamic-tool") {
              const toolPart = part as {
                type: string;
                toolName?: string;
                toolCallId: string;
                state: string;
                input?: unknown;
                output?: unknown;
                errorText?: string;
              };
              const toolName =
                toolPart.toolName ?? part.type.replace("tool-", "");
              return (
                <ToolPart
                  key={i}
                  toolName={toolName}
                  state={toolPart.state}
                  input={toolPart.input}
                  output={toolPart.output}
                  errorText={toolPart.errorText}
                />
              );
            }

            return null;
          })}
        </div>
      </div>

      {isUser && (
        <Avatar className="h-8 w-8 shrink-0">
          <AvatarFallback className="bg-secondary">U</AvatarFallback>
        </Avatar>
      )}
    </div>
  );
}

function TextPartWithSession({
  text,
  isUser,
}: {
  text: string;
  isUser: boolean;
}) {
  const open = useSharedEditSession();
  const compiler = useCompiler();
  const services = useServices();

  if (isUser) {
    return (
      <div className="prose prose-sm prose-invert prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-pre:my-2 prose-code:before:content-none prose-code:after:content-none">
        <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
      </div>
    );
  }

  // includeUnclosed keeps a still-streaming widget fence visible instead of
  // hiding it until the closing fence arrives.
  const parts = extractCodeBlocks(text, { includeUnclosed: true });

  return (
    <div className="prose prose-sm dark:prose-invert prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-pre:my-2 prose-code:before:content-none prose-code:after:content-none">
      {parts.map((part, index) => {
        // Patch fences that could not be applied (or are still streaming)
        // render as plain diffs, never as compilable widget source.
        if (
          part.type === "code" &&
          (part.language === "patch" || part.language === "diff")
        ) {
          return (
            <Markdown key={index} remarkPlugins={[remarkGfm]}>
              {`\`\`\`diff\n${part.content}\`\`\``}
            </Markdown>
          );
        }
        // A block whose closing fence hasn't streamed in yet: show the code
        // arriving live, but don't compile the partial source.
        if (part.type === "code" && part.unclosed) {
          return (
            <div key={index} className="not-prose my-2 border rounded-lg overflow-hidden min-w-0">
              <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 border-b text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>Generating widget…</span>
                {part.attributes?.path && (
                  <span className="font-mono">{part.attributes.path}</span>
                )}
              </div>
              <div className="bg-muted/30 overflow-auto max-h-[40vh]">
                <CodeBlockView content={part.content} language={part.language} />
              </div>
            </div>
          );
        }
        if (part.type === "code") {
          // Widgets declare their SDK namespaces in the fence `uses`
          // attribute; undeclared widgets fall back to every namespace.
          const declared = parseUsesAttribute(part.attributes?.uses);
          return (
            <CodePreview
              key={index}
              code={part.content}
              compiler={compiler}
              services={
                declared.length > 0 ? declared.map((d) => d.namespace) : services
              }
              filePath={part.attributes?.path}
              entrypoint="main.tsx"
              onOpenEditSession={open ?? undefined}
              vfs={workspaceWidgetVfs}
              customPreview={workflowCustomPreview}
            />
          );
        }
        return (
          <Markdown key={index} remarkPlugins={[remarkGfm]}>
            {part.content}
          </Markdown>
        );
      })}
    </div>
  );
}

// The compiler calls POST ${PROXY_URL}/:provider/:operation for widget tool calls.
// Map to the gateway's /tools/:provider/:operation path.
const PROXY_URL = GATEWAY_BASE ? `${GATEWAY_BASE}/tools` : "";

// Chat rides the gateway's `tools/:provider/createChatCompletion` operation.
// A provider is usable once a credential for it exists in the active
// workspace (the gateway's GET /tools only lists credentialed providers).
const CHAT_PROVIDER_KEY = "patchwork:chat-provider";

// Version-pinned: esm.sh caches the unversioned "latest" redirect for hours,
// so a bare spec can silently serve a stale image after a publish.
const IMAGE_SPEC = "@aprovan/patchwork-image-shadcn@0.1.4";
// Local proxy for loading image packages, esm.sh for widget imports
const IMAGE_CDN_URL = import.meta.env.DEV
  ? "/_local-packages"
  : "https://esm.sh";
const WIDGET_CDN_URL = "https://esm.sh"; // Widget imports need esm.sh bundles like @packagedcn

interface GatewayToolEntry {
  provider: string;
  name: string;
  operation: string;
  description?: string;
  inputSchema?: unknown;
}

function toProjectRelativePath(projectId: string, path: string): string {
  const normalizedProjectId = projectId.replace(/^\/+|\/+$/g, "");
  const normalizedPath = path.replace(/^\/+|\/+$/g, "");
  if (!normalizedProjectId) return normalizedPath;
  const prefix = `${normalizedProjectId}/`;
  if (normalizedPath.startsWith(prefix)) {
    return normalizedPath.slice(prefix.length);
  }
  return normalizedPath;
}

/**
 * Compact per-operation signatures for the system prompt's {{tools}} var —
 * enough for the model to emit correct single-object calls without pasting
 * full JSON schemas. Large providers are capped; the registry.search meta
 * tool covers the tail.
 */
const TOOL_PROMPT_CAP_PER_NAMESPACE = 40;

function formatToolSignatures(services: ServiceInfo[]): string {
  const byNamespace = new Map<string, ServiceInfo[]>();
  for (const service of services) {
    const list = byNamespace.get(service.namespace) ?? [];
    list.push(service);
    byNamespace.set(service.namespace, list);
  }
  const lines: string[] = [];
  for (const [namespace, tools] of byNamespace) {
    for (const tool of tools.slice(0, TOOL_PROMPT_CAP_PER_NAMESPACE)) {
      const schema = tool.parameters as
        | { properties?: Record<string, unknown>; required?: string[] }
        | undefined;
      const required = schema?.required ?? [];
      const optional = Object.keys(schema?.properties ?? {}).filter(
        (key) => !required.includes(key),
      );
      const params = [...required, ...optional.map((key) => `${key}?`)]
        .slice(0, 8)
        .join(", ");
      const description = tool.description
        ? ` — ${tool.description.slice(0, 90)}`
        : "";
      lines.push(`- ${namespace}.${tool.procedure}({ ${params} })${description}`);
    }
    if (tools.length > TOOL_PROMPT_CAP_PER_NAMESPACE) {
      lines.push(
        `- …${tools.length - TOOL_PROMPT_CAP_PER_NAMESPACE} more ${namespace} operations — discover with registry.search({ q })`,
      );
    }
  }
  return lines.join("\n");
}

const TABS_KEY_PREFIX = 'patchwork:open-tabs';
const ACTIVE_WORKSPACE_KEY = 'patchwork:active-workspace';

function getTabsStorageKey(workspaceId: string | null): string {
  return workspaceId ? `${TABS_KEY_PREFIX}:${workspaceId}` : TABS_KEY_PREFIX;
}

function loadPersistedTabState(workspaceId: string | null): { paths: string[]; activePath: string | null } {
  try {
    const raw = localStorage.getItem(getTabsStorageKey(workspaceId));
    if (!raw) return { paths: [], activePath: null };
    const parsed = JSON.parse(raw);
    return {
      paths: Array.isArray(parsed.paths) ? parsed.paths : [],
      activePath: typeof parsed.activePath === 'string' ? parsed.activePath : null,
    };
  } catch {
    return { paths: [], activePath: null };
  }
}

function persistTabState(paths: string[], activePath: string | null, workspaceId: string | null) {
  localStorage.setItem(getTabsStorageKey(workspaceId), JSON.stringify({ paths, activePath }));
}

export default function ChatPage() {
  const [input, setInput] = useState(
    "What's the weather in Houston, Texas like?",
  );
  const [compiler, setCompiler] = useState<Compiler | null>(null);
  const [compilerError, setCompilerError] = useState<string | null>(null);
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [services, setServices] = useState<ServiceInfo[]>([]);
  const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([]);
  const [workspaceActivePath, setWorkspaceActivePath] = useState("");
  const [workspaceFilter, setWorkspaceFilter] = useState("");
  const [workspaceTreeVersion, setWorkspaceTreeVersion] = useState(0);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(
    () => localStorage.getItem(ACTIVE_WORKSPACE_KEY),
  );
  const [chatProvider, setChatProvider] = useState<string>(
    () => localStorage.getItem(CHAT_PROVIDER_KEY) ?? "openai",
  );
  const [chatModel, setChatModel] = useState<string>(() =>
    loadModelPreference(localStorage.getItem(CHAT_PROVIDER_KEY) ?? "openai"),
  );
  // Gateway chat provider list (connected state + default models); null while
  // loading or when the gateway is unreachable (static fallback list).
  const [llmProviders, setLlmProviders] = useState<LlmProviderInfo[] | null>(
    null,
  );
  // Providers with a credential in the active workspace; null until the
  // gateway tool list has loaded (unknown → don't block sending).
  const [connectedProviders, setConnectedProviders] = useState<string[] | null>(
    null,
  );
  const [chatContainer, setChatContainer] = useState<HTMLDivElement | null>(
    null,
  );
  const [editSession, setEditSession] = useState<{
    project: VirtualProject;
    initialTreePath?: string;
    initialActiveFile?: string;
  } | null>(null);
  const [openTabs, setOpenTabs] = useState<
    Map<string, { code: string; loading: boolean; error: string | null; stale?: boolean }>
  >(() => {
    const wsId = localStorage.getItem(ACTIVE_WORKSPACE_KEY);
    const { paths } = loadPersistedTabState(wsId);
    return new Map(paths.map((p) => [p, { code: '', loading: true, error: null }]));
  });
  const [activeTabPath, setActiveTabPath] = useState<string | null>(() => {
    const wsId = localStorage.getItem(ACTIVE_WORKSPACE_KEY);
    const { paths, activePath } = loadPersistedTabState(wsId);
    if (activePath && paths.includes(activePath)) return activePath;
    return paths[0] ?? null;
  });
  const [previewCollapsed, setPreviewCollapsed] = useState(false);
  // Workspace tree: static column on md+, off-canvas drawer on small screens.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Shared open state: the header button and the sidebar explorer both open
  // the same workflows panel dialog.
  const [workflowsPanelOpen, setWorkflowsPanelOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const tabRequestRefs = useRef<Map<string, number>>(new Map());
  // Deduplicate listWorkspacePaths() calls when multiple files change in the same poll batch.
  const pendingTreeRefreshRef = useRef(false);

  const [pinnedPaths, setPinnedPaths] = useState<Map<string, boolean>>(() => {
    try {
      const stored = localStorage.getItem('patchwork:pinned-paths');
      if (!stored) return new Map();
      const parsed = JSON.parse(stored) as Array<[string, boolean]> | string[];
      if (parsed.length > 0 && Array.isArray(parsed[0])) {
        return new Map(parsed as Array<[string, boolean]>);
      }
      return new Map((parsed as string[]).map((p) => [p, false]));
    } catch {
      return new Map();
    }
  });

  const togglePin = useCallback((path: string, isDir: boolean) => {
    setPinnedPaths((prev) => {
      const next = new Map(prev);
      if (next.has(path)) next.delete(path);
      else next.set(path, isDir);
      localStorage.setItem('patchwork:pinned-paths', JSON.stringify(Array.from(next)));
      return next;
    });
  }, []);

  const deleteWorkspaceEntry = useCallback((path: string, isDir: boolean) => {
    // Watchers fire per removed path, which closes any open tabs and
    // refreshes the tree — no extra bookkeeping here.
    void deleteWorkspacePath(path, { recursive: isDir }).catch((err) => {
      setWorkspaceError(err instanceof Error ? err.message : "Delete failed");
    });
  }, []);

  const refreshWorkspace = useCallback(async () => {
    setWorkspaceLoading(true);
    setWorkspaceError(null);
    try {
      if (workspaceFilter.trim()) {
        const paths = await listWorkspacePaths();
        setWorkspaceFiles(paths);
      }
      setWorkspaceTreeVersion((prev) => prev + 1);
    } catch (err) {
      setWorkspaceError(
        err instanceof Error ? err.message : "Failed to load workspace",
      );
    } finally {
      setWorkspaceLoading(false);
    }
  }, [workspaceFilter]);

  useEffect(() => {
    return subscribeToWorkspaceChanges((_event, changedPath) => {
      // Mark the specific open tab stale so the user sees a reload prompt.
      if (changedPath) {
        setOpenTabs((prev) => {
          if (!prev.has(changedPath)) return prev;
          const tab = prev.get(changedPath)!;
          if (tab.stale) return prev;
          const next = new Map(prev);
          next.set(changedPath, { ...tab, stale: true });
          return next;
        });
      }

      // Debounce the full tree refresh — all files from a single poll batch
      // fire callbacks synchronously, so only the first one triggers a fetch.
      if (pendingTreeRefreshRef.current) return;
      pendingTreeRefreshRef.current = true;
      setWorkspaceTreeVersion((prev) => prev + 1);
      listWorkspacePaths()
        .then((allPaths) => {
          pendingTreeRefreshRef.current = false;
          if (workspaceFilter.trim()) setWorkspaceFiles(allPaths);
          const existing = new Set(allPaths);
          setOpenTabs((prev) => {
            let changed = false;
            const next = new Map(prev);
            for (const path of next.keys()) {
              if (!existing.has(path)) { next.delete(path); changed = true; }
            }
            return changed ? next : prev;
          });
        })
        .catch(() => { pendingTreeRefreshRef.current = false; });
    });
  }, [workspaceFilter]);

  useEffect(() => {
    if (!workspaceFilter.trim()) return;

    setWorkspaceLoading(true);
    setWorkspaceError(null);

    listWorkspacePaths()
      .then(setWorkspaceFiles)
      .catch((err) => {
        setWorkspaceError(
          err instanceof Error ? err.message : "Failed to load workspace",
        );
      })
      .finally(() => setWorkspaceLoading(false));
  }, [workspaceFilter]);

  useEffect(() => {
    // Fetch available services directly from the gateway.
    // Requires the platform auth flow to have stored a Cognito token and an
    // active workspace id. Gracefully skips when either is absent.
    const fetchGatewayTools = async () => {
      const token = getAccessTokenSync();
      const wsId = localStorage.getItem(ACTIVE_WORKSPACE_KEY);
      if (!token || !wsId || !GATEWAY_BASE) return;

      // Register the active workspace with the gateway (idempotent; non-fatal).
      try {
        await gatewayFetch(`${GATEWAY_BASE}/auth/sessions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspace_id: wsId }),
        });
      } catch {
        // Non-fatal — session may already be established from a prior chat request.
      }

      try {
        const res = await gatewayFetch(`${GATEWAY_BASE}/tools`);
        if (!res.ok) return;
        const data = (await res.json()) as { tools?: GatewayToolEntry[] };
        const tools = data.tools ?? [];
        const providers = Array.from(new Set(tools.map((t) => t.provider)));
        setNamespaces(providers);
        setServices(
          tools.map((t) => ({
            namespace: t.provider,
            name: t.name,
            procedure: t.operation,
            description: t.description ?? "",
            parameters: t.inputSchema as Record<string, unknown> | undefined,
          })),
        );
      } catch {
        setNamespaces([]);
        setServices([]);
      }
    };
    void fetchGatewayTools();

    // Chat provider list — connected flags drive the provider picker. When
    // the stored/default provider has no credential, fall over to the first
    // connected one instead of blocking the composer.
    void fetchLlmProviders().then((providers) => {
      setLlmProviders(providers);
      if (providers) {
        const connected = providers
          .filter((provider) => provider.connected)
          .map((provider) => provider.id);
        setConnectedProviders(connected);
        setChatProvider((current) => {
          if (connected.length === 0 || connected.includes(current)) return current;
          const fallback = connected[0];
          localStorage.setItem(CHAT_PROVIDER_KEY, fallback);
          setChatModel(loadModelPreference(fallback));
          return fallback;
        });
      }
    });

    // Initialize compiler; the loaded image carries its own runtime prompt
    // (PROMPT.md via the `patchwork.prompt` manifest field), composed into
    // the system prompt below.
    createCompiler({
      image: IMAGE_SPEC,
      proxyUrl: PROXY_URL,
      proxyFetch: gatewayFetch,
      cdnBaseUrl: IMAGE_CDN_URL,
      widgetCdnBaseUrl: WIDGET_CDN_URL,
    })
      .then((created) => {
        setCompiler(created);
        setCompilerError(null);
        imagePromptsRef.current = [created.getImage(IMAGE_SPEC)]
          .flatMap((img) => (img?.prompt ? [img.prompt] : []))
          .join("\n\n");
      })
      .catch((err) => {
        console.error(err);
        // Without a compiler every widget silently falls back to "Compiler
        // not initialized" — surface the real cause instead.
        setCompilerError(
          err instanceof Error ? err.message : "Failed to load the widget compiler",
        );
      });

    void refreshWorkspace();
  }, []);

  // Load content for tabs restored from localStorage
  useEffect(() => {
    openTabs.forEach((tab, path) => {
      if (!tab.loading) return;
      const requestId = (tabRequestRefs.current.get(path) ?? 0) + 1;
      tabRequestRefs.current.set(path, requestId);
      loadWorkspaceFileProject(path)
        .then((project) => {
          if (tabRequestRefs.current.get(path) !== requestId) return;
          if (!project) {
            setOpenTabs((prev) => { const next = new Map(prev); next.delete(path); return next; });
            return;
          }
          const file = project.files.get(project.entry);
          setOpenTabs((prev) => {
            const next = new Map(prev);
            next.set(path, { code: file?.content ?? '', loading: false, error: null });
            return next;
          });
        })
        .catch(() => {
          if (tabRequestRefs.current.get(path) !== requestId) return;
          setOpenTabs((prev) => { const next = new Map(prev); next.delete(path); return next; });
        });
    });
  }, []);

  // Persist open tabs to localStorage (scoped by active workspace)
  useEffect(() => {
    persistTabState([...openTabs.keys()], activeTabPath, activeWorkspaceId);
  }, [openTabs, activeTabPath, activeWorkspaceId]);

  // Fix activeTabPath when its tab is removed
  useEffect(() => {
    if (activeTabPath !== null && !openTabs.has(activeTabPath)) {
      setActiveTabPath([...openTabs.keys()][0] ?? null);
    }
  }, [openTabs, activeTabPath]);

  const openSharedEditSession = useCallback(
    async (session: {
      projectId: string;
      entryFile: string;
      filePath?: string;
      initialCode: string;
      initialProject: VirtualProject;
    }) => {
      const { projectId, filePath, entryFile, initialCode, initialProject } =
        session;
      const directoryProject = await loadWorkspaceDirectoryProject(projectId);
      const filePathKey = filePath ?? `${projectId}/${entryFile}`;

      if (directoryProject) {
        const relativePath = toProjectRelativePath(projectId, filePathKey);
        setWorkspaceActivePath(filePathKey);
        setEditSession({
          project: directoryProject,
          initialTreePath: relativePath,
          initialActiveFile: relativePath,
        });
        return;
      }

      const fallbackFilePath = filePathKey;
      const fallbackProject = filePath
        ? createSingleWorkspaceFileProject(filePath, initialCode)
        : initialProject;
      setWorkspaceActivePath(fallbackFilePath);
      setEditSession({
        project: fallbackProject,
        initialTreePath: fallbackProject.entry,
        initialActiveFile: fallbackProject.entry,
      });
    },
    [],
  );

  const openWorkspaceSession = useCallback(
    async (path: string, isDir: boolean) => {
      const project = isDir
        ? await loadWorkspaceDirectoryProject(path)
        : await loadWorkspaceFileProject(path);
      if (!project) return;

      setWorkspaceActivePath(path);
      setSidebarOpen(false);
      setEditSession({
        project,
        initialTreePath: project.entry,
        initialActiveFile: project.entry,
      });
    },
    [],
  );

  const openWorkspacePreview = useCallback((path: string) => {
    setWorkspaceActivePath(path);
    setActiveTabPath(path);
    setPreviewCollapsed(false);
    setSidebarOpen(false);

    // If tab already open, just activate it
    setOpenTabs((prev) => {
      if (prev.has(path)) return prev;
      const next = new Map(prev);
      next.set(path, { code: "", loading: true, error: null });
      return next;
    });

    const requestId = (tabRequestRefs.current.get(path) ?? 0) + 1;
    tabRequestRefs.current.set(path, requestId);

    void loadWorkspaceFileProject(path)
      .then((project) => {
        if (tabRequestRefs.current.get(path) !== requestId) return;
        if (!project) {
          setOpenTabs((prev) => {
            const next = new Map(prev);
            next.set(path, { code: "", loading: false, error: "Failed to load file preview" });
            return next;
          });
          return;
        }
        const file = project.files.get(project.entry);
        setOpenTabs((prev) => {
          const next = new Map(prev);
          next.set(path, { code: file?.content ?? "", loading: false, error: null });
          return next;
        });
      })
      .catch((err) => {
        if (tabRequestRefs.current.get(path) !== requestId) return;
        setOpenTabs((prev) => {
          const next = new Map(prev);
          next.set(path, {
            code: "",
            loading: false,
            error: err instanceof Error ? err.message : "Failed to load file preview",
          });
          return next;
        });
      });
  }, []);

  const closeTab = useCallback((path: string) => {
    setOpenTabs((prev) => {
      const next = new Map(prev);
      next.delete(path);
      return next;
    });
    setActiveTabPath((prev) => {
      if (prev !== path) return prev;
      // Activate an adjacent tab
      const paths = [...openTabs.keys()];
      const idx = paths.indexOf(path);
      if (paths.length <= 1) return null;
      return paths[idx > 0 ? idx - 1 : idx + 1] ?? null;
    });
  }, [openTabs]);

  const closeAllTabs = useCallback(() => {
    setOpenTabs(new Map());
    setActiveTabPath(null);
  }, []);

  const reloadStaleTab = useCallback((path: string) => {
    setOpenTabs((prev) => {
      const next = new Map(prev);
      next.set(path, { code: '', loading: true, error: null, stale: false });
      return next;
    });

    const requestId = (tabRequestRefs.current.get(path) ?? 0) + 1;
    tabRequestRefs.current.set(path, requestId);

    void loadWorkspaceFileProject(path)
      .then((project) => {
        if (tabRequestRefs.current.get(path) !== requestId) return;
        if (!project) {
          setOpenTabs((prev) => {
            const next = new Map(prev);
            next.set(path, { code: '', loading: false, error: 'Failed to reload file', stale: false });
            return next;
          });
          return;
        }
        const file = project.files.get(project.entry);
        setOpenTabs((prev) => {
          const next = new Map(prev);
          next.set(path, { code: file?.content ?? '', loading: false, error: null, stale: false });
          return next;
        });
      })
      .catch(() => {
        if (tabRequestRefs.current.get(path) !== requestId) return;
        setOpenTabs((prev) => {
          const next = new Map(prev);
          next.set(path, { code: '', loading: false, error: 'Failed to reload file', stale: false });
          return next;
        });
      });
  }, []);

  const handleWorkspaceSwitch = useCallback(
    (newWorkspaceId: string) => {
      localStorage.setItem(ACTIVE_WORKSPACE_KEY, newWorkspaceId);
      setActiveWorkspaceId(newWorkspaceId);
      setOpenTabs(new Map());
      setActiveTabPath(null);
      setPinnedPaths(new Map());
      setEditSession(null);
      resetStore();
      void refreshWorkspace();
    },
    [refreshWorkspace],
  );

  const handleWorkspaceLoad = useCallback(
    (serverActiveId: string | null) => {
      if (!serverActiveId) return;
      const storedId = localStorage.getItem(ACTIVE_WORKSPACE_KEY);
      if (serverActiveId === storedId) return;
      // Server and localStorage disagree — trust the server
      localStorage.setItem(ACTIVE_WORKSPACE_KEY, serverActiveId);
      setActiveWorkspaceId(serverActiveId);
      setOpenTabs(new Map());
      setActiveTabPath(null);
      setPinnedPaths(new Map());
      resetStore();
      void refreshWorkspace();
    },
    [refreshWorkspace],
  );

  const filteredWorkspaceFiles = useMemo(() => {
    const query = workspaceFilter.trim().toLowerCase();
    if (!query) return workspaceFiles;
    return workspaceFiles.filter((path) => path.toLowerCase().includes(query));
  }, [workspaceFiles, workspaceFilter]);

  const patchworkCtx = useMemo(
    () => ({ compiler, namespaces }),
    [compiler, namespaces],
  );

  // Read via refs inside prepareSendMessagesRequest so provider/model
  // switches apply to the next send even though useChat holds on to the
  // transport instance.
  const chatProviderRef = useRef(chatProvider);
  chatProviderRef.current = chatProvider;
  const chatModelRef = useRef(chatModel);
  chatModelRef.current = chatModel;
  // Prompt composition inputs, read at send time: per-image runtime prompts
  // (from each image's manifest), the live namespace list, and compact tool
  // signatures so generated calls match the real SDK contract.
  const imagePromptsRef = useRef("");
  const namespacesRef = useRef<string[]>([]);
  namespacesRef.current = namespaces;
  const servicesRef = useRef<ServiceInfo[]>([]);
  servicesRef.current = services;

  // Chat rides the gateway's /llm/:provider/chat — provider aliases resolve
  // to OpenAI-compatible UTDK modules server-side, and the response is the
  // AI SDK UI message stream DefaultChatTransport expects.
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `${GATEWAY_BASE}/llm/${chatProviderRef.current}/chat`,
        // gatewayFetch carries the bearer token (X-Aprovan-Authorization) and
        // the CloudFront OAC payload hash (x-amz-content-sha256).
        fetch: gatewayFetch,
        prepareSendMessagesRequest: ({ messages }) => ({
          api: `${GATEWAY_BASE}/llm/${chatProviderRef.current}/chat`,
          body: {
            messages,
            ...(chatModelRef.current ? { model: chatModelRef.current } : {}),
            // The wrapper prompt is server-managed (PostHog → WFS fallback);
            // the client only supplies the runtime-derived vars.
            prompt: {
              id: "chat-patchwork-widget",
              vars: {
                images:
                  imagePromptsRef.current ||
                  `- \`${IMAGE_SPEC}\` (no runtime prompt published)`,
                namespaces: namespacesRef.current,
                tools:
                  formatToolSignatures(servicesRef.current) ||
                  "(tool list unavailable — stick to the documented native namespaces)",
              },
            },
          },
        }),
      }),
    [],
  );

  const { messages, sendMessage, status, error } = useChat({ transport });

  // Fold diff-based widget edits: `patch` fences are applied against the
  // sources accumulated across the conversation and rewritten into full
  // files, so rendering (and the editor) never sees a diff.
  const resolvedMessages = useMemo(() => {
    const sources = new Map<string, string>();
    return messages.map((message) => {
      if (message.role !== "assistant" || !message.parts) return message;
      return {
        ...message,
        parts: message.parts.map((part) =>
          part.type === "text"
            ? { ...part, text: resolvePatchesInText(part.text, sources) }
            : part,
        ),
      } as typeof message;
    });
  }, [messages]);

  const providerConnected =
    connectedProviders === null || connectedProviders.includes(chatProvider);
  const chatProviderLabel =
    CHAT_PROVIDERS.find((p) => p.id === chatProvider)?.label ?? chatProvider;

  const handleProviderChange = useCallback((provider: string) => {
    localStorage.setItem(CHAT_PROVIDER_KEY, provider);
    setChatProvider(provider);
    setChatModel(loadModelPreference(provider));
  }, []);

  const handleModelChange = useCallback(
    (model: string) => {
      saveModelPreference(chatProvider, model);
      setChatModel(model);
    },
    [chatProvider],
  );

  const isLoading = status === "submitted" || status === "streaming";

  const handleSubmit = useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();
      if (!input.trim() || !providerConnected) return;
      sendMessage({ text: input });
      setInput("");
    },
    [input, sendMessage, providerConnected],
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  return (
    <PatchworkCtx.Provider value={patchworkCtx}>
      <SharedEditSessionCtx.Provider value={openSharedEditSession}>
        <div
          className="flex flex-col h-dvh max-w-6xl mx-auto p-0 sm:p-4"
          ref={setChatContainer}
        >
          <Card className="flex-1 flex flex-col min-h-0 overflow-hidden border max-sm:rounded-none max-sm:border-x-0">
            {/* Shared shell header (same AppHeader as the home page and
                registry) with chat-specific controls in its slots. */}
            <AppHeader
              className="static border-b bg-transparent backdrop-blur-none"
              homeHref="https://aprovan.com/"
              leading={
                <button
                  onClick={() => setSidebarOpen((open) => !open)}
                  className="md:hidden p-1.5 -ml-1 rounded hover:bg-muted"
                  title="Toggle workspace files"
                >
                  <PanelLeft className="h-4 w-4" />
                </button>
              }
              links={[
                { label: "Home", href: "https://aprovan.com/" },
                { label: "Registry", href: "https://aprovan.com/registry/" },
              ]}
              logo={
                <img
                  src={APROVAN_LOGO}
                  alt="Aprovan"
                  className="h-7 w-7 rounded-full"
                />
              }
              name="patchwork"
            >
              <ServicesMenu services={services} />
              <WorkflowsMenu
                onOpenScript={openWorkspacePreview}
                open={workflowsPanelOpen}
                onOpenChange={setWorkflowsPanelOpen}
              />
              <SessionControls
                onLoad={handleWorkspaceLoad}
                onSwitch={handleWorkspaceSwitch}
              />
            </AppHeader>

            <CardContent className="flex-1 p-0 min-h-0 flex relative">
              {sidebarOpen && (
                <div
                  className="md:hidden absolute inset-0 z-30 bg-black/40"
                  onClick={() => setSidebarOpen(false)}
                />
              )}
              <div
                className={`${
                  sidebarOpen ? "flex" : "hidden"
                } md:flex flex-col min-h-0 border-r bg-background md:bg-muted/20 absolute inset-y-0 left-0 z-40 w-72 max-w-[85vw] shadow-lg md:static md:w-72 md:max-w-none md:shadow-none`}
              >
                <div className="px-3 py-2 border-b flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <span>Workspace</span>
                  <button
                    onClick={() => void refreshWorkspace()}
                    className="ml-auto p-1 rounded hover:bg-muted"
                    title="Refresh workspace"
                  >
                    <RefreshCw
                      className={`h-3 w-3 ${
                        workspaceLoading ? "animate-spin" : ""
                      }`}
                    />
                  </button>
                </div>
                <div className="p-2 border-b">
                  <Input
                    value={workspaceFilter}
                    onChange={(e) => setWorkspaceFilter(e.target.value)}
                    placeholder="Filter files..."
                    className="h-8"
                  />
                </div>
                {workspaceError ? (
                  <div className="p-3 text-xs text-destructive">
                    {workspaceError}
                  </div>
                ) : workspaceFilter.trim() ? (
                  <FileTree
                    files={toWorkspaceTreeFiles(filteredWorkspaceFiles)}
                    activePath={workspaceActivePath}
                    onSelectFile={openWorkspacePreview}
                    onSelectDirectory={setWorkspaceActivePath}
                    onOpenInEditor={openWorkspaceSession}
                    openInEditorMode="all"
                    openInEditorTitle="Edit"
                    pinnedPaths={pinnedPaths}
                    onTogglePin={togglePin}
                    onDeletePath={deleteWorkspaceEntry}
                    title="Files"
                  />
                ) : (
                  <FileTree
                    files={[]}
                    activePath={workspaceActivePath}
                    onSelectFile={openWorkspacePreview}
                    onSelectDirectory={setWorkspaceActivePath}
                    onOpenInEditor={openWorkspaceSession}
                    openInEditorMode="all"
                    openInEditorTitle="Edit"
                    directoryLoader={listWorkspaceEntries}
                    pageSize={10}
                    reloadToken={workspaceTreeVersion}
                    pinnedPaths={pinnedPaths}
                    onTogglePin={togglePin}
                    onDeletePath={deleteWorkspaceEntry}
                    title="Files"
                  />
                )}
                <div className="mt-auto">
                  <WorkflowsExplorer
                    onOpenScript={(path) => {
                      setSidebarOpen(false);
                      openWorkspacePreview(path);
                    }}
                    onOpenPanel={() => setWorkflowsPanelOpen(true)}
                  />
                </div>
              </div>
              <div className="flex-1 min-h-0 flex flex-col">
                {openTabs.size > 0 && (
                  <div className="border-b bg-muted/10">
                    {/* Tab bar */}
                    <div className="flex items-center border-b bg-muted/30">
                      <div className="flex-1 flex items-center overflow-x-auto min-w-0">
                        {[...openTabs.entries()].map(([path, tab]) => {
                          const fileName = path.split("/").pop() ?? path;
                          const isActive = path === activeTabPath;
                          const isStale = tab.stale ?? false;
                          return (
                            <button
                              key={path}
                              onClick={() => {
                                setActiveTabPath(path);
                                setWorkspaceActivePath(path);
                                setPreviewCollapsed(false);
                              }}
                              className={`group relative flex items-center gap-1.5 px-3 py-1.5 text-xs border-r shrink-0 max-w-[200px] ${
                                isActive
                                  ? "bg-background text-foreground border-b-2 border-b-primary"
                                  : "text-muted-foreground hover:bg-muted/50"
                              }`}
                              title={isStale ? `${path} — modified externally` : path}
                            >
                              {isStale && (
                                <span className="shrink-0 h-1.5 w-1.5 rounded-full bg-orange-400" title="Modified externally" />
                              )}
                              <span className={`truncate ${isStale ? "text-orange-600 dark:text-orange-400" : ""}`}>{fileName}</span>
                              {isStale && (
                                <span
                                  role="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    reloadStaleTab(path);
                                  }}
                                  className="shrink-0 p-0.5 rounded hover:bg-muted-foreground/20 opacity-0 group-hover:opacity-100 transition-opacity"
                                  title="Reload from server"
                                >
                                  <RotateCcw className="h-3 w-3" />
                                </span>
                              )}
                              <span
                                role="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  closeTab(path);
                                }}
                                className="shrink-0 p-0.5 rounded hover:bg-muted-foreground/20 opacity-0 group-hover:opacity-100 transition-opacity"
                                title="Close tab"
                              >
                                <X className="h-3 w-3" />
                              </span>
                            </button>
                          );
                        })}
                      </div>
                      <div className="flex items-center gap-0.5 px-1 shrink-0">
                        <button
                          onClick={() => setPreviewCollapsed((p) => !p)}
                          className="p-1 rounded hover:bg-muted"
                          title={previewCollapsed ? "Expand preview" : "Collapse preview"}
                        >
                          {previewCollapsed ? (
                            <ChevronDown className="h-3.5 w-3.5" />
                          ) : (
                            <Minus className="h-3.5 w-3.5" />
                          )}
                        </button>
                        <button
                          onClick={closeAllTabs}
                          className="p-1 rounded hover:bg-muted"
                          title="Close all tabs"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Active tab content */}
                    {!previewCollapsed && activeTabPath && openTabs.has(activeTabPath) && (() => {
                      const tab = openTabs.get(activeTabPath)!;
                      return (
                        <div key={activeTabPath} className="bg-card min-h-24">
                          {tab.stale && !tab.loading && (
                            <div className="px-3 py-1.5 text-xs bg-orange-50 dark:bg-orange-950/40 border-b border-orange-200 dark:border-orange-800 flex items-center gap-2 text-orange-700 dark:text-orange-400">
                              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                              <span>This file was modified externally.</span>
                              <button
                                onClick={() => reloadStaleTab(activeTabPath)}
                                className="ml-auto underline hover:no-underline"
                              >
                                Reload
                              </button>
                              <button
                                onClick={() => setOpenTabs((prev) => {
                                  const t = prev.get(activeTabPath);
                                  if (!t) return prev;
                                  const next = new Map(prev);
                                  next.set(activeTabPath, { ...t, stale: false });
                                  return next;
                                })}
                                className="underline hover:no-underline"
                              >
                                Keep local
                              </button>
                            </div>
                          )}
                          {tab.loading ? (
                            <div className="p-3 flex items-center gap-2 text-muted-foreground">
                              <Loader2 className="h-4 w-4 animate-spin" />
                              <span className="text-sm">Loading file preview...</span>
                            </div>
                          ) : tab.error ? (
                            <div className="p-3 text-sm text-destructive flex items-center gap-2">
                              <AlertCircle className="h-4 w-4 shrink-0" />
                              <span>{tab.error}</span>
                            </div>
                          ) : (
                            <CodePreview
                              code={tab.code}
                              compiler={compiler}
                              services={namespaces}
                              filePath={activeTabPath}
                              onOpenEditSession={openSharedEditSession}
                              vfs={workspaceWidgetVfs}
                              customPreview={workflowCustomPreview}
                            />
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}
                <ScrollArea className="h-full flex-1" ref={scrollRef}>
                  <div className="p-3 sm:p-4 space-y-4">
                    {messages.length === 0 ? (
                      <div className="text-center text-muted-foreground py-12">
                        <img
                          src={APROVAN_LOGO}
                          alt=""
                          className="h-12 w-12 mx-auto mb-4 opacity-50 rounded-full"
                        />
                        <p>Start a conversation</p>
                      </div>
                    ) : (
                      resolvedMessages.map((msg) => (
                        <MessageBubble key={msg.id} message={msg} />
                      ))
                    )}

                    {isLoading &&
                      messages[messages.length - 1]?.role !== "assistant" && (
                        <div className="flex gap-3 justify-start">
                          <Avatar className="h-8 w-8 shrink-0">
                            <img
                              src={APROVAN_LOGO}
                              alt=""
                              className="rounded-full"
                            />
                            <AvatarFallback>A</AvatarFallback>
                          </Avatar>
                          <div className="flex flex-col gap-1">
                            <div className="h-5" />
                            <div className="bg-muted rounded-lg px-4 py-2">
                              <Loader2 className="h-4 w-4 animate-spin" />
                            </div>
                          </div>
                        </div>
                      )}
                  </div>
                </ScrollArea>
              </div>
            </CardContent>

            {error && (
              <div className="px-4 py-2 bg-destructive/10 text-destructive text-sm flex items-center gap-2">
                <AlertCircle className="h-4 w-4" />
                {error.message}
              </div>
            )}

            {compilerError && (
              <div className="px-4 py-2 bg-destructive/10 text-destructive text-sm flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>Widget previews unavailable — {compilerError}</span>
              </div>
            )}

            <div className="p-2.5 sm:p-4 border-t space-y-2">
              <div className="flex items-center">
                <ProviderModelControls
                  providers={llmProviders}
                  active={chatProvider}
                  onSelectProvider={handleProviderChange}
                  model={chatModel}
                  onSelectModel={handleModelChange}
                  loadModels={fetchLlmModels}
                />
              </div>

              {!providerConnected && (
                <div className="px-3 py-2 text-xs rounded-md border border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 flex items-center gap-2">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    Chat requires an LLM provider credential. {chatProviderLabel}{" "}
                    is not connected to this workspace —{" "}
                    <a
                      href={credentialsUrl(chatProvider)}
                      target="_blank"
                      rel="noreferrer"
                      className="underline hover:no-underline font-medium"
                    >
                      add a credential
                    </a>{" "}
                    or switch providers above.
                  </span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="flex gap-2 items-end">
                <MarkdownEditor
                  value={input}
                  onChange={setInput}
                  onSubmit={() => {
                    if (!isLoading && input.trim() && providerConnected) {
                      handleSubmit();
                    }
                  }}
                  placeholder="Type a message... (Shift+Enter for new line)"
                  disabled={isLoading}
                />
                <Button
                  type="submit"
                  disabled={isLoading || !input.trim() || !providerConnected}
                  className="shrink-0"
                  title={
                    providerConnected
                      ? undefined
                      : `${chatProviderLabel} is not connected — add a credential first`
                  }
                >
                  {isLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </form>
            </div>
          </Card>

          {/* The edit pill only makes sense while a widget surface is on
              screen — an open preview tab — never on a bare chat. */}
          {!editSession && openTabs.size > 0 && !previewCollapsed && (
            <Bobbin
              container={chatContainer}
              pillContainer={chatContainer}
              defaultActive={false}
              showInspector
              onChanges={() => undefined}
              exclude={[".bobbin-pill", "[data-bobbin]"]}
            />
          )}
        </div>
        {editSession && (
          <EditModal
            isOpen
            onClose={() => setEditSession(null)}
            onSaveProject={async (project) => {
              await saveWorkspaceProject(project);
              await refreshWorkspace();
            }}
            originalProject={editSession.project}
            initialActiveFile={editSession.initialActiveFile}
            initialTreePath={editSession.initialTreePath}
            apiEndpoint="/api/edit"
            initialState={{ showPreview: true, showTree: true }}
            compile={async (code) => {
              if (!compiler) return { success: true };
              try {
                await compiler.compile(
                  code,
                  createPreviewManifest(namespaces),
                  { typescript: true },
                );
                return { success: true };
              } catch (err) {
                return {
                  success: false,
                  error:
                    err instanceof Error ? err.message : "Compilation failed",
                };
              }
            }}
            renderPreview={(code) => (
              <WidgetPreview
                code={code}
                compiler={compiler}
                services={namespaces}
              />
            )}
            previewLoading={!compiler}
          />
        )}
      </SharedEditSessionCtx.Provider>
    </PatchworkCtx.Provider>
  );
}
