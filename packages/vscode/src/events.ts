import * as vscode from "vscode";
import { updateProxyStatus, type ExtensionDeps } from "./commands";
import { getHistoryForDoc, initializeEmbeddedStitchery } from "./utils";

export function registerEventHandlers(
  context: vscode.ExtensionContext,
  deps: ExtensionDeps,
): void {
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (!editor) return;
      deps.previewProvider.updateDocument(editor.document);
      deps.previewProvider.postMessage({
        type: "editHistorySet",
        payload: { entries: getHistoryForDoc(deps.editHistory, editor.document) },
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
      const root = deps.projectRoots.get(parsed.projectId);
      if (!root) return;
      await writeProjectFile(root, parsed.filePath, document.getText());
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      if (event.document !== editor.document) return;
      deps.previewProvider.updateDocument(event.document);
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("patchwork.copilotProxyUrl")) {
        void updateProxyStatus(deps.statusBar);
      }
      if (
        event.affectsConfiguration("patchwork.mcpServers") ||
        event.affectsConfiguration("patchwork.utcpConfig")
      ) {
        void initializeEmbeddedStitchery(deps.embeddedStitchery, deps.previewProvider);
      }
    }),
  );
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
