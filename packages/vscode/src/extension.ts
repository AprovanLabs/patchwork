import * as vscode from "vscode";
import { registerCommands, runEditRequest, updateProxyStatus, type ExtensionDeps } from "./commands";
import { registerEventHandlers } from "./events";
import { PatchworkFileSystemProvider } from "./providers/PatchworkFileSystemProvider";
import { PatchworkTreeProvider } from "./providers/PatchworkTreeProvider";
import { PreviewPanelProvider } from "./providers/PreviewPanelProvider";
import { EmbeddedStitchery, type ServiceCallMessage } from "./services/EmbeddedStitchery";
import { getHistoryForDoc, initializeEmbeddedStitchery } from "./utils";
import type { VirtualProject } from "@aprovan/patchwork-compiler";

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

  const deps: ExtensionDeps = {
    treeProvider,
    fileSystemProvider,
    diagnostics,
    projectRoots,
    projects,
    editHistory,
    embeddedStitchery,
    statusBar,
    previewProvider,
  };

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

  registerCommands(context, deps);
  registerEventHandlers(context, deps);

  void updateProxyStatus(statusBar);
  void initializeEmbeddedStitchery(embeddedStitchery, previewProvider);
}

export function deactivate() {}

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
