import * as vscode from "vscode";
import type { PreviewPanelProvider } from "./providers/PreviewPanelProvider";
import type { EmbeddedStitchery } from "./services/EmbeddedStitchery";

export function getHistoryForDoc(
  history: Map<string, Array<{ prompt: string; summary: string }>>,
  document: vscode.TextDocument,
): Array<{ prompt: string; summary: string }> {
  return history.get(document.uri.toString()) ?? [];
}

export function setHistoryForDoc(
  history: Map<string, Array<{ prompt: string; summary: string }>>,
  document: vscode.TextDocument,
  entries: Array<{ prompt: string; summary: string }>,
): void {
  history.set(document.uri.toString(), entries);
}

export async function initializeEmbeddedStitchery(
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
