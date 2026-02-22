import * as path from "path";
import * as vscode from "vscode";
import {
  createProjectFromFiles,
  type VirtualFile,
  type VirtualProject,
} from "@aprovan/patchwork-compiler";
import { PatchworkFileSystemProvider } from "./providers/PatchworkFileSystemProvider";
import { PatchworkTreeProvider } from "./providers/PatchworkTreeProvider";
import { PreviewPanelProvider } from "./providers/PreviewPanelProvider";
import { EditService } from "./services/EditService";
import {
  EmbeddedStitchery,
  type ServiceCallMessage,
} from "./services/EmbeddedStitchery";

export function activate(context: vscode.ExtensionContext) {
  const treeProvider = new PatchworkTreeProvider();
  const fileSystemProvider = new PatchworkFileSystemProvider();
  const diagnostics = vscode.languages.createDiagnosticCollection("patchwork");
  const projectRoots = new Map<string, vscode.Uri>();
  const projects = new Map<string, VirtualProject>();
  const editHistory = new Map<
    string,
    Array<{ prompt: string; summary: string }>
  >();
  const embeddedStitchery = new EmbeddedStitchery();
  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
  );
  statusBar.command = "patchwork.testConnection";
  statusBar.tooltip = "Patchwork: Copilot proxy status";
  statusBar.show();
  const previewProvider = new PreviewPanelProvider(context, {
    onCompileError: (payload, document) => {
      if (!document) return;
      diagnostics.set(document.uri, toDiagnostics(payload, document));
    },
    onCompileSuccess: (document) => {
      if (!document) return;
      diagnostics.delete(document.uri);
    },
    onEditRequest: async (payload, document) => {
      if (!document) return;
      const request = parseEditRequest(payload);
      if (!request) return;
      await runEditRequest(
        request.prompt,
        document,
        previewProvider,
        editHistory,
      );
    },
    onServiceCall: async (payload) => {
      const call = parseServiceCall(payload);
      if (!call) return;
      const result = await embeddedStitchery.handleServiceCall(call);
      previewProvider.postMessage({ type: "serviceResult", payload: result });
    },
    onWebviewReady: () => {
      previewProvider.postMessage({
        type: "setServices",
        payload: { namespaces: embeddedStitchery.getNamespaces() },
      });
      const doc = vscode.window.activeTextEditor?.document;
      if (doc) {
        previewProvider.postMessage({
          type: "editHistorySet",
          payload: { entries: getHistoryForDoc(editHistory, doc) },
        });
      }
    },
  });
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("patchworkExplorer", treeProvider),
  );
  context.subscriptions.push(diagnostics);
  context.subscriptions.push(statusBar);
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider(
      "patchwork",
      fileSystemProvider,
      { isCaseSensitive: true },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("patchwork.openProject", async () => {
      const selection = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: "Open Patchwork Project",
      });

      const folderUri = selection?.[0];
      if (!folderUri) return;

      const project = await loadProjectFromFolder(folderUri);
      if (!project) {
        vscode.window.showWarningMessage(
          "Patchwork: no supported files found in the selected folder.",
        );
        return;
      }

      treeProvider.setProject(project.id, project);
      fileSystemProvider.setProject(project.id, project);
      projectRoots.set(project.id, folderUri);
      projects.set(project.id, project);

      await vscode.commands.executeCommand(
        "patchwork.openFile",
        project.id,
        project.entry,
      );
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("patchwork.showPreview", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage(
          "Patchwork: open a file to preview.",
        );
        return;
      }

      previewProvider.showPreview(editor.document);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "patchwork.openFile",
      async (projectId: string, filePath: string) => {
        const uri = buildPatchworkUri(projectId, filePath);
        await vscode.commands.executeCommand("vscode.open", uri);
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("patchwork.editWithAI", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage("Patchwork: open a file to edit.");
        return;
      }

      const prompt = await vscode.window.showInputBox({
        prompt: "Describe the edit you want",
      });
      if (!prompt) return;

      await runEditRequest(
        prompt,
        editor.document,
        previewProvider,
        editHistory,
      );
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("patchwork.showEditHistory", async () => {
      previewProvider.postMessage({ type: "editHistoryToggle" });
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("patchwork.testConnection", async () => {
      const ok = await updateProxyStatus(statusBar);
      if (ok) {
        vscode.window.showInformationMessage(
          "Patchwork: Copilot proxy is reachable.",
        );
      } else {
        vscode.window.showWarningMessage(
          "Patchwork: Copilot proxy is unreachable.",
        );
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("patchwork.exportProject", async () => {
      if (projects.size === 0) {
        vscode.window.showInformationMessage(
          "Patchwork: open a project before exporting.",
        );
        return;
      }

      const projectId = await pickProjectId(projects);
      if (!projectId) return;
      const project = projects.get(projectId);
      if (!project) return;

      const target = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: "Export Patchwork Project",
      });
      const targetDir = target?.[0];
      if (!targetDir) return;

      await exportProject(project, targetDir);
      vscode.window.showInformationMessage(
        `Patchwork: exported ${project.id}.`,
      );
    }),
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (!editor) return;
      previewProvider.updateDocument(editor.document);
      previewProvider.postMessage({
        type: "editHistorySet",
        payload: { entries: getHistoryForDoc(editHistory, editor.document) },
      });
    }),
  );

  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      ["typescriptreact", "javascriptreact"],
      {
        provideCodeActions(document, range) {
          const action = new vscode.CodeAction(
            "Edit with Patchwork AI",
            vscode.CodeActionKind.QuickFix,
          );
          action.command = {
            command: "patchwork.editWithAI",
            title: "Edit with Patchwork AI",
            arguments: [document.uri, range],
          };
          return [action];
        },
      },
      {
        providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
      },
    ),
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async (document) => {
      if (document.uri.scheme !== "patchwork") return;
      const parsed = parsePatchworkUri(document.uri);
      if (!parsed) return;
      const root = projectRoots.get(parsed.projectId);
      if (!root) return;
      await writeProjectFile(root, parsed.filePath, document.getText());
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      if (event.document !== editor.document) return;
      previewProvider.updateDocument(event.document);
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("patchwork.copilotProxyUrl")) {
        void updateProxyStatus(statusBar);
      }
      if (
        event.affectsConfiguration("patchwork.mcpServers") ||
        event.affectsConfiguration("patchwork.utcpConfig")
      ) {
        void initializeEmbeddedStitchery(embeddedStitchery, previewProvider);
      }
    }),
  );

  void updateProxyStatus(statusBar);
  void initializeEmbeddedStitchery(embeddedStitchery, previewProvider);
}

export function deactivate() {}

async function loadProjectFromFolder(
  folderUri: vscode.Uri,
): Promise<VirtualProject | null> {
  const files: VirtualFile[] = [];
  const ignoredDirs = new Set([
    ".git",
    "node_modules",
    ".turbo",
    "dist",
    "build",
    ".next",
    ".cache",
  ]);
  const ignoredFiles = new Set([".DS_Store"]);

  const walk = async (dirUri: vscode.Uri): Promise<void> => {
    const entries = await vscode.workspace.fs.readDirectory(dirUri);
    for (const [name, type] of entries) {
      if (type === vscode.FileType.Directory && ignoredDirs.has(name)) {
        continue;
      }
      if (type === vscode.FileType.File && ignoredFiles.has(name)) {
        continue;
      }

      const entryUri = vscode.Uri.joinPath(dirUri, name);
      if (type === vscode.FileType.Directory) {
        await walk(entryUri);
        continue;
      }
      if (type !== vscode.FileType.File) continue;

      const bytes = await vscode.workspace.fs.readFile(entryUri);
      const hasNull = bytes.some((value) => value === 0);
      const content = hasNull
        ? Buffer.from(bytes).toString("base64")
        : Buffer.from(bytes).toString("utf8");

      const relative = path
        .relative(folderUri.fsPath, entryUri.fsPath)
        .split(path.sep)
        .join("/");

      files.push({
        path: relative,
        content,
        encoding: hasNull ? "base64" : "utf8",
      });
    }
  };

  await walk(folderUri);
  if (files.length === 0) return null;

  const projectId = path.basename(folderUri.fsPath);
  return createProjectFromFiles(files, projectId);
}

function buildPatchworkUri(projectId: string, filePath: string): vscode.Uri {
  return vscode.Uri.parse(`patchwork://${projectId}/${filePath}`);
}

function parsePatchworkUri(
  uri: vscode.Uri,
): { projectId: string; filePath: string } | null {
  if (uri.scheme !== "patchwork") return null;
  const projectId = uri.authority;
  const filePath = uri.path.replace(/^\/+/, "");
  if (!projectId || !filePath) return null;
  return { projectId, filePath };
}

async function writeProjectFile(
  root: vscode.Uri,
  filePath: string,
  content: string,
): Promise<void> {
  const segments = filePath.split("/");
  const target = vscode.Uri.joinPath(root, ...segments);
  if (segments.length > 1) {
    const dir = vscode.Uri.joinPath(root, ...segments.slice(0, -1));
    await vscode.workspace.fs.createDirectory(dir);
  }
  await vscode.workspace.fs.writeFile(target, Buffer.from(content, "utf8"));
}

async function exportProject(
  project: VirtualProject,
  targetDir: vscode.Uri,
): Promise<void> {
  for (const [filePath, file] of project.files) {
    const segments = filePath.split("/");
    const target = vscode.Uri.joinPath(targetDir, ...segments);
    if (segments.length > 1) {
      const dir = vscode.Uri.joinPath(targetDir, ...segments.slice(0, -1));
      await vscode.workspace.fs.createDirectory(dir);
    }
    const content =
      file.encoding === "base64"
        ? Buffer.from(file.content, "base64")
        : Buffer.from(file.content, "utf8");
    await vscode.workspace.fs.writeFile(target, content);
  }
}

async function pickProjectId(
  projects: Map<string, VirtualProject>,
): Promise<string | undefined> {
  if (projects.size === 1) {
    return projects.keys().next().value;
  }
  const options = Array.from(projects.keys()).sort();
  return vscode.window.showQuickPick(options, {
    placeHolder: "Select a Patchwork project",
  });
}

function toDiagnostics(
  payload: unknown,
  document: vscode.TextDocument,
): vscode.Diagnostic[] {
  const data =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};
  const message =
    typeof data.message === "string" ? data.message : "Patchwork compile error";
  const line = typeof data.line === "number" ? data.line : 1;
  const column = typeof data.column === "number" ? data.column : 1;
  const position = new vscode.Position(
    clampLine(line - 1, document),
    Math.max(0, column - 1),
  );
  const range = new vscode.Range(position, position);
  const diagnostic = new vscode.Diagnostic(
    range,
    message,
    vscode.DiagnosticSeverity.Error,
  );
  return [diagnostic];
}

async function updateProxyStatus(
  statusBar: vscode.StatusBarItem,
): Promise<boolean> {
  statusBar.text = "$(sync~spin) Patchwork";
  const config = vscode.workspace.getConfiguration("patchwork");
  const baseUrl = config.get<string>(
    "copilotProxyUrl",
    "http://localhost:3000",
  );
  try {
    const response = await fetch(`${baseUrl}/health`);
    if (response.ok) {
      statusBar.text = "$(plug) Patchwork";
      statusBar.tooltip = "Copilot Proxy: Connected";
      return true;
    }
  } catch {
    // Ignore network errors and fall through to disconnected state.
  }

  statusBar.text = "$(debug-disconnect) Patchwork";
  statusBar.tooltip = "Copilot Proxy: Disconnected";
  return false;
}

function clampLine(line: number, document: vscode.TextDocument): number {
  const maxLine = Math.max(0, document.lineCount - 1);
  return Math.min(Math.max(0, line), maxLine);
}

function parseEditRequest(payload: unknown): { prompt: string } | null {
  if (!payload || typeof payload !== "object") return null;
  const data = payload as Record<string, unknown>;
  if (typeof data.prompt !== "string" || !data.prompt.trim()) return null;
  return { prompt: data.prompt.trim() };
}

function parseServiceCall(payload: unknown): ServiceCallMessage | null {
  if (!payload || typeof payload !== "object") return null;
  const data = payload as Record<string, unknown>;
  const id = typeof data.id === "string" ? data.id : null;
  const namespace = typeof data.namespace === "string" ? data.namespace : null;
  const procedure = typeof data.procedure === "string" ? data.procedure : null;
  const args =
    data.args && typeof data.args === "object"
      ? (data.args as Record<string, unknown>)
      : {};
  if (!id || !namespace || !procedure) return null;
  return { id, namespace, procedure, args };
}

async function runEditRequest(
  prompt: string,
  document: vscode.TextDocument,
  previewProvider: PreviewPanelProvider,
  historyStore: Map<string, Array<{ prompt: string; summary: string }>>,
): Promise<void> {
  const history = getHistoryForDoc(historyStore, document);
  const editService = createEditService();
  let combined = "";

  previewProvider.postMessage({
    type: "editProgress",
    payload: { chunk: "", done: false },
  });

  try {
    for await (const chunk of editService.streamEdit(
      document.getText(),
      prompt,
    )) {
      combined += chunk;
      previewProvider.postMessage({
        type: "editProgress",
        payload: { chunk, done: false },
      });
    }

    const updated = extractEditedCode(combined);
    await applyDocumentEdit(document, updated);
    history.push({ prompt, summary: summarizeEdit(combined) });
    setHistoryForDoc(historyStore, document, history);
    previewProvider.postMessage({
      type: "editHistorySet",
      payload: { entries: history },
    });
    previewProvider.postMessage({
      type: "editProgress",
      payload: { chunk: "", done: true },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Edit failed";
    previewProvider.postMessage({
      type: "editError",
      payload: { message },
    });
    vscode.window.showErrorMessage(`Patchwork edit failed: ${message}`);
  }
}

function createEditService(): EditService {
  const config = vscode.workspace.getConfiguration("patchwork");
  const baseUrl = config.get<string>(
    "copilotProxyUrl",
    "http://localhost:3000",
  );
  return new EditService(baseUrl);
}

function extractEditedCode(response: string): string {
  const fence = response.match(/```[a-zA-Z0-9]*\n([\s\S]*?)```/);
  if (fence && fence[1]) {
    return fence[1].trimEnd();
  }
  return response.trimEnd();
}

function summarizeEdit(response: string): string {
  const cleaned = response.replace(/```[\s\S]*?```/g, "").trim();
  if (!cleaned) return "Edit applied.";
  const firstLine = cleaned.split("\n").find((line) => line.trim());
  return (firstLine ?? "Edit applied.").slice(0, 200);
}

function getHistoryForDoc(
  history: Map<string, Array<{ prompt: string; summary: string }>>,
  document: vscode.TextDocument,
): Array<{ prompt: string; summary: string }> {
  return history.get(document.uri.toString()) ?? [];
}

function setHistoryForDoc(
  history: Map<string, Array<{ prompt: string; summary: string }>>,
  document: vscode.TextDocument,
  entries: Array<{ prompt: string; summary: string }>,
): void {
  history.set(document.uri.toString(), entries);
}

async function applyDocumentEdit(
  document: vscode.TextDocument,
  text: string,
): Promise<void> {
  const editor = await vscode.window.showTextDocument(document, {
    preserveFocus: true,
    preview: false,
  });
  const fullRange = new vscode.Range(
    document.positionAt(0),
    document.positionAt(document.getText().length),
  );
  await editor.edit((builder) => {
    builder.replace(fullRange, text);
  });
}

async function initializeEmbeddedStitchery(
  embeddedStitchery: EmbeddedStitchery,
  previewProvider: PreviewPanelProvider,
): Promise<void> {
  const config = vscode.workspace.getConfiguration("patchwork");
  const mcpServers = config.get("mcpServers") as
    | Array<{ name: string; command: string; args?: string[] }>
    | undefined;
  const utcp = config.get("utcpConfig") as Record<string, unknown> | undefined;

  await embeddedStitchery.initialize({
    mcpServers: (mcpServers ?? []).map((server) => ({
      name: server.name,
      command: server.command,
      args: server.args ?? [],
    })),
    utcp,
  });

  previewProvider.postMessage({
    type: "setServices",
    payload: { namespaces: embeddedStitchery.getNamespaces() },
  });
}
