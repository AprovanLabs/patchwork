import * as path from "path";
import { createProjectFromFiles, type VirtualFile, type VirtualProject } from "@aprovan/patchwork-compiler";
import * as vscode from "vscode";
import { EditService } from "./services/EditService";
import { getHistoryForDoc, setHistoryForDoc } from "./utils";
import type { PatchworkFileSystemProvider } from "./providers/PatchworkFileSystemProvider";
import type { PatchworkTreeProvider } from "./providers/PatchworkTreeProvider";
import type { PreviewPanelProvider } from "./providers/PreviewPanelProvider";
import type { EmbeddedStitchery } from "./services/EmbeddedStitchery";
export interface ExtensionDeps {
  treeProvider: PatchworkTreeProvider;
  fileSystemProvider: PatchworkFileSystemProvider;
  diagnostics: vscode.DiagnosticCollection;
  projectRoots: Map<string, vscode.Uri>;
  projects: Map<string, VirtualProject>;
  editHistory: Map<string, Array<{ prompt: string; summary: string }>>;
  embeddedStitchery: EmbeddedStitchery;
  statusBar: vscode.StatusBarItem;
  previewProvider: PreviewPanelProvider;
}

export function registerCommands(
  context: vscode.ExtensionContext,
  deps: ExtensionDeps,
): void {
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

      deps.treeProvider.setProject(project.id, project);
      deps.fileSystemProvider.setProject(project.id, project);
      deps.projectRoots.set(project.id, folderUri);
      deps.projects.set(project.id, project);

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

      deps.previewProvider.showPreview(editor.document);
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
        deps.previewProvider,
        deps.editHistory,
      );
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("patchwork.showEditHistory", async () => {
      deps.previewProvider.postMessage({ type: "editHistoryToggle" });
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("patchwork.testConnection", async () => {
      const ok = await updateProxyStatus(deps.statusBar);
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
      if (deps.projects.size === 0) {
        vscode.window.showInformationMessage(
          "Patchwork: open a project before exporting.",
        );
        return;
      }

      const projectId = await pickProjectId(deps.projects);
      if (!projectId) return;
      const project = deps.projects.get(projectId);
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
}

export async function runEditRequest(
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

export async function updateProxyStatus(
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
