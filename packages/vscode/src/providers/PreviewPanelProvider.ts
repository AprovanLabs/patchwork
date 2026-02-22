import * as path from "path";
import * as vscode from "vscode";

interface PreviewMessage {
  type: string;
  payload?: unknown;
}

export interface PreviewPanelHandlers {
  onCompileError?: (payload: unknown, document?: vscode.TextDocument) => void;
  onCompileSuccess?: (document?: vscode.TextDocument) => void;
  onEditRequest?: (payload: unknown, document?: vscode.TextDocument) => void;
  onServiceCall?: (payload: unknown) => void;
  onWebviewReady?: () => void;
}

export class PreviewPanelProvider {
  private panel: vscode.WebviewPanel | undefined;
  private activeDocument: vscode.TextDocument | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly handlers: PreviewPanelHandlers = {},
  ) {}

  showPreview(document: vscode.TextDocument): void {
    if (!this.isPreviewableDocument(document)) {
      vscode.window.showInformationMessage(
        "Patchwork: preview supports .tsx/.jsx files only.",
      );
      return;
    }
    this.activeDocument = document;

    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      this.postActiveDocument();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      "patchworkPreview",
      "Patchwork Preview",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );

    this.panel.webview.html = this.getWebviewHtml(this.panel.webview);
    this.panel.webview.onDidReceiveMessage(
      (message: PreviewMessage) => {
        if (message?.type === "ready") {
          this.postActiveDocument();
          this.handlers.onWebviewReady?.();
          return;
        }

        if (message?.type === "compileError") {
          this.handlers.onCompileError?.(message.payload, this.activeDocument);
          return;
        }

        if (message?.type === "compileSuccess") {
          this.handlers.onCompileSuccess?.(this.activeDocument);
          return;
        }

        if (message?.type === "editRequest") {
          this.handlers.onEditRequest?.(message.payload, this.activeDocument);
          return;
        }

        if (message?.type === "serviceCall") {
          this.handlers.onServiceCall?.(message.payload);
        }
      },
      undefined,
      this.context.subscriptions,
    );

    this.panel.onDidDispose(() => {
      this.panel = undefined;
      this.activeDocument = undefined;
    });
  }

  updateDocument(document: vscode.TextDocument): void {
    if (!this.panel) return;
    if (!this.isPreviewableDocument(document)) return;
    this.activeDocument = document;
    this.postActiveDocument();
  }

  private postActiveDocument(): void {
    if (!this.panel || !this.activeDocument) return;
    const payload = {
      uri: this.activeDocument.uri.toString(),
      languageId: this.activeDocument.languageId,
      text: this.activeDocument.getText(),
    };
    this.panel.webview.postMessage({ type: "updateFile", payload });
  }

  postMessage(message: PreviewMessage): void {
    if (!this.panel) return;
    this.panel.webview.postMessage(message);
  }

  private getWebviewHtml(webview: vscode.Webview): string {
    const nonce = this.getNonce();
    const csp = `default-src 'none'; img-src ${webview.cspSource} https:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' https:; connect-src https:;`;
    const compilerUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.context.extensionUri,
        "node_modules",
        "@aprovan",
        "patchwork-compiler",
        "dist",
        "index.js",
      ),
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Patchwork Preview</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      margin: 0;
      padding: 16px;
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
    }
    .header {
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      opacity: 0.7;
      margin-bottom: 12px;
    }
    pre {
      white-space: pre-wrap;
      word-break: break-word;
      border-radius: 8px;
      padding: 12px;
      background: var(--vscode-editorWidget-background);
    }
    #preview {
      min-height: 120px;
      border-radius: 8px;
      padding: 12px;
      background: var(--vscode-editorWidget-background);
      margin-bottom: 12px;
    }
    .error {
      background: var(--vscode-inputValidation-errorBackground);
      color: var(--vscode-inputValidation-errorForeground);
      border: 1px solid var(--vscode-inputValidation-errorBorder);
      border-radius: 6px;
      padding: 8px 10px;
      margin-bottom: 12px;
      font-size: 12px;
      white-space: pre-wrap;
    }
    .edit-bar {
      display: flex;
      gap: 8px;
      align-items: center;
      margin-bottom: 12px;
    }
    .edit-input {
      flex: 1;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      border-radius: 6px;
      padding: 6px 8px;
    }
    .edit-submit {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 6px;
      padding: 6px 10px;
      cursor: pointer;
    }
    .edit-submit:hover {
      background: var(--vscode-button-hoverBackground);
    }
    .edit-secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: none;
      border-radius: 6px;
      padding: 6px 10px;
      cursor: pointer;
    }
    .edit-secondary:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }
    .edit-status {
      font-size: 11px;
      opacity: 0.7;
    }
    .history-panel {
      border-radius: 8px;
      border: 1px solid var(--vscode-panel-border);
      background: var(--vscode-sideBar-background);
      margin-bottom: 12px;
    }
    .history-header {
      padding: 8px 10px;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      opacity: 0.7;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .history-list {
      max-height: 200px;
      overflow-y: auto;
      padding: 8px 10px;
      display: grid;
      gap: 10px;
    }
    .history-item {
      background: var(--vscode-editorWidget-background);
      border-radius: 6px;
      padding: 8px 10px;
      border: 1px solid var(--vscode-panel-border);
    }
    .history-prompt {
      font-size: 12px;
      font-weight: 600;
      margin-bottom: 6px;
    }
    .history-summary {
      font-size: 12px;
      opacity: 0.8;
    }
  </style>
</head>
<body>
  <div class="header">
    <span>Patchwork Preview</span>
    <span id="services-label" class="services-label"></span>
  </div>
  <div id="error" class="error" hidden></div>
  <form id="edit-form" class="edit-bar">
    <input id="edit-input" class="edit-input" placeholder="Ask Patchwork to edit" />
    <button id="edit-submit" class="edit-submit" type="submit">Edit</button>
    <button id="history-toggle" class="edit-secondary" type="button">History</button>
    <span id="edit-status" class="edit-status"></span>
  </form>
  <section id="history-panel" class="history-panel" hidden>
    <div class="history-header">Edit History</div>
    <div id="history-list" class="history-list"></div>
  </section>
  <div id="preview"></div>
  <pre id="payload">Waiting for file...</pre>
  <script type="module" nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const output = document.getElementById('payload');
    const previewRoot = document.getElementById('preview');
    const errorBox = document.getElementById('error');
    const compilerUrl = "${compilerUri}";
    const fallbackCompilerUrl = "https://esm.sh/@aprovan/patchwork-compiler@0.1.0";
    const imagePackage = "@aprovan/patchwork-image-shadcn";
    const proxyBase = "https://patchwork.local/api/proxy";
    let compiler = null;
    let mounted = null;
    let editBuffer = '';
    const pendingServices = new Map();
    let serviceNamespaces = [];
    const servicesLabel = document.getElementById('services-label');

    async function loadCompiler() {
      try {
        return await import(compilerUrl);
      } catch (error) {
        console.warn('[patchwork-vscode] Failed to load local compiler:', error);
        return import(fallbackCompilerUrl);
      }
    }

    async function ensureCompiler() {
      if (compiler) return compiler;
      const mod = await loadCompiler();
        compiler = await mod.createCompiler({
        image: imagePackage,
          proxyUrl: proxyBase,
      });
      return compiler;
    }

    function setError(message) {
      if (!message) {
        errorBox.hidden = true;
        display: flex;
        align-items: center;
        justify-content: space-between;
        errorBox.textContent = '';
      .services-label {
        font-size: 10px;
        text-transform: none;
        letter-spacing: 0.02em;
        padding: 4px 6px;
        border-radius: 999px;
        background: var(--vscode-badge-background);
        color: var(--vscode-badge-foreground);
        opacity: 0.9;
      }
        return;
      }
      errorBox.hidden = false;
      errorBox.textContent = message;
    }

    async function compileAndMount(text) {
      if (!previewRoot) return;
      try {
        setError('');
        const activeCompiler = await ensureCompiler();
        if (mounted) {
          activeCompiler.unmount(mounted);
          mounted = null;
        }
        const manifest = {
          name: 'preview',
          version: '0.0.0',
          platform: 'browser',
          image: imagePackage,
        };
        const widget = await activeCompiler.compile(text, manifest, {
          typescript: true,
        });
        mounted = await activeCompiler.mount(widget, {
          target: previewRoot,
          mode: 'embedded',
        });
        vscode.postMessage({ type: 'compileSuccess' });
      } catch (error) {
        const err = error instanceof Error ? error : new Error('Compile failed');
        setError(err.message);
        vscode.postMessage({
          type: 'compileError',
          payload: { message: err.message, line: 1, column: 1 },
        });
      }
    }

    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url && url.startsWith(proxyBase)) {
        const parsed = new URL(url);
        const parts = parsed.pathname.split('/').filter(Boolean);
        const namespace = parts[2];
        const procedure = parts.slice(3).join('/');
        const body = init?.body ? JSON.parse(init.body) : {};
        const args = body.args || {};
        try {
          const result = await callService(namespace, procedure, args);
          if (result && result.error) {
            return new Response(JSON.stringify({ error: result.error }), {
              status: 500,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          return new Response(JSON.stringify(result?.result ?? result), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        } catch (error) {
          const err = error instanceof Error ? error.message : 'Service call failed';
          return new Response(JSON.stringify({ error: err }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }
      return originalFetch(input, init);
    };

    function callService(namespace, procedure, args) {
      const id = Date.now() + '-' + Math.random().toString(36).slice(2, 10);
      return new Promise((resolve) => {
        pendingServices.set(id, resolve);
        vscode.postMessage({
          type: 'serviceCall',
          payload: { id, namespace, procedure, args },
        });
      });
    }

    window.addEventListener('message', (event) => {
      const message = event.data;
      if (!message) return;
      if (message.type === 'updateFile') {
        const payload = message.payload || {};
        output.textContent = payload.text || 'No content.';
        const code = payload.text || '';
        compileAndMount(code);
        return;
      }
      if (message.type === 'serviceResult') {
        const payload = message.payload || {};
        const handler = pendingServices.get(payload.id);
        if (handler) {
          pendingServices.delete(payload.id);
          handler(payload);
        }
        return;
      }
      if (message.type === 'editHistorySet') {
        const payload = message.payload || {};
        renderHistory(payload.entries || []);
        return;
      }
      if (message.type === 'editHistoryToggle') {
        toggleHistory();
        return;
      }
      if (message.type === 'setServices') {
        const payload = message.payload || {};
        serviceNamespaces = payload.namespaces || [];
        if (servicesLabel) {
          const count = serviceNamespaces.length;
          servicesLabel.textContent = count === 0
            ? 'No services'
            : 'Services: ' + serviceNamespaces.join(', ');
        }
        return;
      }
      if (message.type === 'editProgress') {
        const payload = message.payload || {};
        if (payload.chunk) {
          editBuffer += payload.chunk;
        }
        if (payload.done) {
          output.textContent = editBuffer || output.textContent;
          editBuffer = '';
          if (status) status.textContent = 'Applied.';
        }
        return;
      }
      if (message.type === 'editError') {
        const payload = message.payload || {};
        setError(payload.message || 'Edit failed');
        if (status) status.textContent = 'Failed.';
      }
    });

    const form = document.getElementById('edit-form');
    const input = document.getElementById('edit-input');
    const submit = document.getElementById('edit-submit');
    const status = document.getElementById('edit-status');
    const historyToggle = document.getElementById('history-toggle');
    const historyPanel = document.getElementById('history-panel');
    const historyList = document.getElementById('history-list');

    form?.addEventListener('submit', (event) => {
      event.preventDefault();
      const prompt = input?.value?.trim();
      if (!prompt) return;
      if (status) status.textContent = 'Editing...';
      editBuffer = '';
      vscode.postMessage({
        type: 'editRequest',
        payload: { prompt },
      });
      if (input) input.value = '';
    });

    historyToggle?.addEventListener('click', () => {
      toggleHistory();
      vscode.postMessage({ type: 'editHistoryToggle' });
    });

    function toggleHistory() {
      if (!historyPanel) return;
      historyPanel.hidden = !historyPanel.hidden;
    }

    function renderHistory(entries) {
      if (!historyList) return;
      historyList.innerHTML = '';
      if (!entries || entries.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'history-item';
        empty.textContent = 'No edits yet.';
        historyList.appendChild(empty);
        return;
      }
      entries.forEach((entry) => {
        const item = document.createElement('div');
        item.className = 'history-item';
        const prompt = document.createElement('div');
        prompt.className = 'history-prompt';
        prompt.textContent = entry.prompt || 'Edit';
        const summary = document.createElement('div');
        summary.className = 'history-summary';
        summary.textContent = entry.summary || '';
        item.appendChild(prompt);
        item.appendChild(summary);
        historyList.appendChild(item);
      });
    }

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }

  private getNonce(): string {
    let text = "";
    const possible =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i += 1) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }

  private isPreviewableDocument(document: vscode.TextDocument): boolean {
    const ext = path.extname(document.uri.path).toLowerCase();
    return ext === ".tsx" || ext === ".jsx";
  }
}
