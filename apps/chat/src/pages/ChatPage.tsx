import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import {
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
  createContext,
  useContext,
} from "react";
import {
  Send,
  Loader2,
  Wrench,
  AlertCircle,
  Brain,
  ChevronDown,
  Minus,
  RefreshCw,
  X,
} from "lucide-react";
import { Bobbin } from '@aprovan/bobbin';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogHeader,
  DialogContent,
  DialogClose,
} from "@/components/ui/dialog";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { UIMessage } from "ai";
import { createCompiler, type Compiler } from "@aprovan/patchwork-compiler";
import {
  extractCodeBlocks,
  CodePreview,
  WidgetPreview,
  MarkdownEditor,
  ServicesInspector,
  EditModal,
  FileTree,
  type ServiceInfo,
} from "@aprovan/patchwork-editor";
import type { VirtualProject } from "@aprovan/patchwork-compiler";
import {
  listWorkspaceEntries,
  listWorkspacePaths,
  toWorkspaceTreeFiles,
  loadWorkspaceDirectoryProject,
  loadWorkspaceFileProject,
  createSingleWorkspaceFileProject,
  saveWorkspaceProject,
  subscribeToWorkspaceChanges,
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

      <CollapsibleContent className="mt-2 p-3 rounded-lg border bg-white space-y-2">
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
        className={`flex flex-col gap-1 max-w-[80%] min-w-0 ${
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

  const parts = extractCodeBlocks(text);

  return (
    <div className="prose prose-sm dark:prose-invert prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-pre:my-2 prose-code:before:content-none prose-code:after:content-none">
      {parts.map((part, index) => {
        if (part.type === "code") {
          return (
            <CodePreview
              key={index}
              code={part.content}
              compiler={compiler}
              services={services}
              filePath={part.attributes?.path}
              entrypoint="main.tsx"
              onOpenEditSession={open ?? undefined}
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

const PROXY_URL = "/api/proxy";
const IMAGE_SPEC = "@aprovan/patchwork-image-shadcn";
// Local proxy for loading image packages, esm.sh for widget imports
const IMAGE_CDN_URL = import.meta.env.DEV
  ? "/_local-packages"
  : "https://esm.sh";
const WIDGET_CDN_URL = "https://esm.sh"; // Widget imports need esm.sh bundles like @packagedcn

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

const TABS_STORAGE_KEY = 'patchwork:open-tabs';

function loadPersistedTabState(): { paths: string[]; activePath: string | null } {
  try {
    const raw = localStorage.getItem(TABS_STORAGE_KEY);
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

function persistTabState(paths: string[], activePath: string | null) {
  localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify({ paths, activePath }));
}

export default function ChatPage() {
  const [input, setInput] = useState(
    "What's the weather in Houston, Texas like?",
  );
  const [compiler, setCompiler] = useState<Compiler | null>(null);
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [services, setServices] = useState<ServiceInfo[]>([]);
  const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([]);
  const [workspaceActivePath, setWorkspaceActivePath] = useState("");
  const [workspaceFilter, setWorkspaceFilter] = useState("");
  const [workspaceTreeVersion, setWorkspaceTreeVersion] = useState(0);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [chatContainer, setChatContainer] = useState<HTMLDivElement | null>(
    null,
  );
  const [editSession, setEditSession] = useState<{
    project: VirtualProject;
    initialTreePath?: string;
    initialActiveFile?: string;
  } | null>(null);
  const [openTabs, setOpenTabs] = useState<
    Map<string, { code: string; loading: boolean; error: string | null }>
  >(() => {
    const { paths } = loadPersistedTabState();
    return new Map(paths.map((p) => [p, { code: '', loading: true, error: null }]));
  });
  const [activeTabPath, setActiveTabPath] = useState<string | null>(() => {
    const { paths, activePath } = loadPersistedTabState();
    if (activePath && paths.includes(activePath)) return activePath;
    return paths[0] ?? null;
  });
  const [previewCollapsed, setPreviewCollapsed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const tabRequestRefs = useRef<Map<string, number>>(new Map());

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
    return subscribeToWorkspaceChanges(() => {
      setWorkspaceTreeVersion((prev) => prev + 1);
      listWorkspacePaths()
        .then((allPaths) => {
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
        .catch(() => {});
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
    // Fetch available services
    fetch("/api/services")
      .then((res) => res.json())
      .then((data) => {
        setNamespaces(data.namespaces ?? []);
        // In dev mode, also store full service details for inspection
        if (import.meta.env.DEV && data.services) {
          setServices(data.services);
        }
      })
      .catch(() => {
        setNamespaces([]);
        setServices([]);
      });

    // Initialize compiler
    createCompiler({
      image: IMAGE_SPEC,
      proxyUrl: PROXY_URL,
      cdnBaseUrl: IMAGE_CDN_URL,
      widgetCdnBaseUrl: WIDGET_CDN_URL,
    })
      .then(setCompiler)
      .catch(console.error);

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

  // Persist open tabs to localStorage
  useEffect(() => {
    persistTabState([...openTabs.keys()], activeTabPath);
  }, [openTabs, activeTabPath]);

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

  const filteredWorkspaceFiles = useMemo(() => {
    const query = workspaceFilter.trim().toLowerCase();
    if (!query) return workspaceFiles;
    return workspaceFiles.filter((path) => path.toLowerCase().includes(query));
  }, [workspaceFiles, workspaceFilter]);

  const patchworkCtx = useMemo(
    () => ({ compiler, namespaces }),
    [compiler, namespaces],
  );

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        body: () => ({
          metadata: {
            patchwork: { compilers: [IMAGE_SPEC] },
          },
        }),
      }),
    [],
  );

  const { messages, sendMessage, status, error } = useChat({ transport });

  const isLoading = status === "submitted" || status === "streaming";

  const handleSubmit = useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();
      if (!input.trim()) return;
      sendMessage({ text: input });
      setInput("");
    },
    [input, sendMessage],
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
          className="flex flex-col h-screen max-w-6xl mx-auto p-4"
          ref={setChatContainer}
        >
          <Card className="flex-1 flex flex-col min-h-0 overflow-hidden border">
            <CardHeader className="border-b py-3">
              <CardTitle className="flex items-center gap-3">
                <img
                  src={APROVAN_LOGO}
                  alt="Aprovan"
                  className="h-8 w-8 rounded-full"
                />
                <span className="text-lg">patchwork</span>
                <ServicesInspector
                  namespaces={namespaces}
                  services={services}
                  DialogComponent={({ open, onOpenChange, children }) => (
                    <Dialog
                      open={open ?? false}
                      onOpenChange={onOpenChange ?? (() => undefined)}
                    >
                      {children}
                    </Dialog>
                  )}
                  DialogHeaderComponent={DialogHeader}
                  DialogContentComponent={DialogContent}
                  DialogCloseComponent={({ onClose }) => (
                    <DialogClose onClose={onClose ?? (() => undefined)} />
                  )}
                />
              </CardTitle>
            </CardHeader>

            <CardContent className="flex-1 p-0 min-h-0 flex">
              <div className="w-64 border-r bg-muted/20 min-h-0 flex flex-col min-w-sm">
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
                    title="Files"
                  />
                )}
              </div>
              <div className="flex-1 min-h-0 flex flex-col">
                {openTabs.size > 0 && (
                  <div className="border-b bg-muted/10">
                    {/* Tab bar */}
                    <div className="flex items-center border-b bg-muted/30">
                      <div className="flex-1 flex items-center overflow-x-auto min-w-0">
                        {[...openTabs.entries()].map(([path]) => {
                          const fileName = path.split("/").pop() ?? path;
                          const isActive = path === activeTabPath;
                          return (
                            <button
                              key={path}
                              onClick={() => {
                                setActiveTabPath(path);
                                setWorkspaceActivePath(path);
                                setPreviewCollapsed(false);
                              }}
                              className={`group relative flex items-center gap-1.5 px-3 py-1.5 text-xs border-r shrink-0 max-w-[180px] ${
                                isActive
                                  ? "bg-background text-foreground border-b-2 border-b-primary"
                                  : "text-muted-foreground hover:bg-muted/50"
                              }`}
                              title={path}
                            >
                              <span className="truncate">{fileName}</span>
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
                        <div key={activeTabPath} className="bg-white min-h-24">
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
                            />
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}
                <ScrollArea className="h-full flex-1" ref={scrollRef}>
                  <div className="p-4 space-y-4">
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
                      messages.map((msg) => (
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

            <div className="p-4 border-t">
              <form onSubmit={handleSubmit} className="flex gap-2 items-end">
                <MarkdownEditor
                  value={input}
                  onChange={setInput}
                  onSubmit={() => {
                    if (!isLoading && input.trim()) {
                      handleSubmit();
                    }
                  }}
                  placeholder="Type a message... (Shift+Enter for new line)"
                  disabled={isLoading}
                />
                <Button
                  type="submit"
                  disabled={isLoading || !input.trim()}
                  className="shrink-0"
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

          {!editSession && (
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
