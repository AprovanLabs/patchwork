# Patchwork Viewer VS Code

Implement a VS Code extension for viewing Patchwork projects. This should be a fairly simple wrapper around the existing Patchwork file viewer/editor/render, with a few differences:

1. The file selector widget shouldn't be shown for Patchwork. Instead, the extension should render a file tree using VS Code's native components. When a file is selected (opened), it should communicate this to Patchwork
2. When a file stored in a Patchwork project is opened, it should operate like a normal VS Code file, opening as an open file rather than in the Patchwork tree.
3. The preview renderer should show the Patchwork compilation/renderer, if supported. Defer to VS Code's in-built editor/preview otherwise (e.g. let VS Code's Markdown preview show)

Keep the same LLM-driven editing functionality and editor widget that Patchwork provides for browser-based widgets. The chat-based method and history  editing should be available for all files, too.

We'll need a way to connect to an LLM provider. Provide a method for connecting to the GitHub Code Copilot proxy that we already use (i.e. let me run the Copilot proxy and give the extension the option to point to it. )

Where needed, prefer to add functionality to the other Patchwork packages/components rather than bundling into the VS Code extension (e.g. disabling the file tree viewer should be a Patchwork component property).

---

## Technical Overview

### Existing Patchwork Architecture

The Patchwork monorepo contains these relevant packages:

| Package | Purpose |
|---------|---------|
| `@aprovan/patchwork` | Core services/types, service proxy system, context providers |
| `@aprovan/patchwork-editor` | React components: `MarkdownEditor`, `CodePreview`, `FileTree`, `EditModal`, `EditHistory`, `useEditSession` |
| `@aprovan/bobbin` | Visual element selection/editing with design tokens and change tracking |
| `@aprovan/patchwork-compiler` | JSX→ESM compilation, image loading, DOM mounting (`createCompiler`, `mount`, `unmount`) |
| `@aprovan/patchwork-stitchery` | LLM server (Vercel AI SDK), MCP client integration, service registry, edit/chat prompts |
| `@aprovan/patchwork-utcp` | Backend service integration through UTCP protocol |
| `@aprovan/patchwork-vscode` | **Placeholder** - only contains package.json stub |

### Key Existing Components

**Editor Package (`@aprovan/patchwork-editor`)**:
- `FileTree.tsx` - React file tree component with `VirtualFile[]` input, supports file selection and media upload
- `EditModal.tsx` - Full editing UI with code view, preview, edit history, and LLM edit submission
- `useEditSession.ts` - React hook managing edit state, history, API calls to `/api/edit`
- `CodePreview.tsx` - Live compilation preview with save-to-VFS capability
- `api.ts` - `sendEditRequest()` for LLM-powered code edits

**Compiler Package (`@aprovan/patchwork-compiler`)**:
- `createCompiler(options)` - Returns a `Compiler` instance
- `compiler.compile(source, manifest, options)` - Compiles JSX/TSX to widget
- `compiler.mount(widget, { target, mode })` - Mounts to DOM element
- `compiler.unmount(mounted)` - Cleanup
- Supports browser platform with image packages (`@aprovan/patchwork-image-shadcn`)

**Stitchery Package (`@aprovan/patchwork-stitchery`)**:
- `createStitcheryServer(config)` - HTTP server with `/api/chat`, `/api/edit`, `/api/services` routes
- Uses `@ai-sdk/openai-compatible` provider pointed at Copilot proxy
- `ServiceRegistry` for tool discovery and registration
- `PATCHWORK_PROMPT`, `EDIT_PROMPT` - System prompts for LLM

**Copilot Proxy (`@aprovan/copilot-proxy`)**:
- Standalone package providing OpenAI-compatible API using GitHub Copilot
- `copilot-proxy serve --port 3000` starts the proxy server
- Device flow authentication via `copilot-proxy connect`
- Already used by stitchery server for LLM access

---

## Implementation Plan

### Phase 1: Extension Foundation

#### 1.1 Project Setup (`packages/vscode/`)

```
packages/vscode/
├── package.json          # VS Code extension manifest
├── tsconfig.json
├── tsup.config.ts        # Bundle for VS Code
├── src/
│   ├── extension.ts      # activate/deactivate
│   ├── commands/         # Command handlers
│   ├── providers/        # Tree, Editor, Preview providers
│   ├── webview/          # Webview panel logic
│   └── config.ts         # Settings management
└── media/
    └── webview/          # Bundled React app for webviews
```

**package.json contributions**:
```json
{
  "activationEvents": ["onView:patchworkExplorer", "onCommand:patchwork.*"],
  "contributes": {
    "viewsContainers": {
      "activitybar": [{
        "id": "patchwork",
        "title": "Patchwork",
        "icon": "media/icon.svg"
      }]
    },
    "views": {
      "patchwork": [{
        "id": "patchworkExplorer",
        "name": "Projects"
      }]
    },
    "commands": [
      { "command": "patchwork.openProject", "title": "Open Patchwork Project" },
      { "command": "patchwork.newProject", "title": "New Patchwork Project" },
      { "command": "patchwork.showPreview", "title": "Show Patchwork Preview" },
      { "command": "patchwork.editWithAI", "title": "Edit with AI" }
    ],
    "configuration": {
      "title": "Patchwork",
      "properties": {
        "patchwork.copilotProxyUrl": {
          "type": "string",
          "default": "http://localhost:3000",
          "description": "URL of the GitHub Copilot proxy server"
        },
        "patchwork.imagePackage": {
          "type": "string",
          "default": "@aprovan/patchwork-image-shadcn",
          "description": "Default image package for widget compilation"
        },
        "patchwork.vfsDir": {
          "type": "string",
          "default": "",
          "description": "Directory for virtual file system storage (defaults to workspace)"
        }
      }
    },
    "menus": {
      "editor/title": [{
        "command": "patchwork.showPreview",
        "when": "resourceExtname =~ /\\.(tsx|jsx)$/",
        "group": "navigation"
      }]
    }
  }
}
```

#### 1.2 Patchwork Project Tree Provider

Replace the React `FileTree` with VS Code's native `TreeDataProvider`:

```typescript
// src/providers/PatchworkTreeProvider.ts
import * as vscode from 'vscode';
import type { VirtualProject, VirtualFile } from '@aprovan/patchwork-compiler';

export class PatchworkTreeProvider implements vscode.TreeDataProvider<PatchworkTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<PatchworkTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  
  private projects: Map<string, VirtualProject> = new Map();
  
  setProject(id: string, project: VirtualProject): void {
    this.projects.set(id, project);
    this._onDidChangeTreeData.fire(undefined);
  }
  
  getTreeItem(element: PatchworkTreeItem): vscode.TreeItem { /* ... */ }
  getChildren(element?: PatchworkTreeItem): Thenable<PatchworkTreeItem[]> { /* ... */ }
}
```

**File selection behavior**:
- Clicking a file in the tree opens it in VS Code's standard editor
- The extension listens for `vscode.window.onDidChangeActiveTextEditor` to sync state
- Preview panel updates when a compilable file is selected

#### 1.3 Webview Preview Panel

Create a webview that hosts the compiled widget preview:

```typescript
// src/providers/PreviewPanelProvider.ts
export class PreviewPanelProvider {
  private panel: vscode.WebviewPanel | undefined;
  
  async showPreview(document: vscode.TextDocument): Promise<void> {
    // Create or reveal panel
    // Send code to webview for compilation via postMessage
  }
  
  private getWebviewContent(): string {
    // Returns HTML that loads the bundled React preview app
    // Includes @aprovan/patchwork-compiler and image package
  }
}
```

**Webview React App** (`media/webview/`):
- Minimal React app using `createCompiler()` and `mount()`
- Listens for `window.addEventListener('message', ...)` to receive code updates
- Reports compilation errors back to extension

### Phase 2: Package Modifications

#### 2.1 Editor Package Changes

**Add `hideFileTree` prop to `EditModal`**:

```typescript
// @aprovan/patchwork-editor - EditModal.tsx
export interface EditModalProps extends UseEditSessionOptions {
  // ... existing props
  hideFileTree?: boolean;  // NEW: Hide built-in file tree for VS Code integration
}
```

**Export standalone edit components**:
- `EditHistoryPanel` - Just the history list
- `EditInputBar` - Just the prompt input with submit
- `BobbinOverlay` - Visual selection without modal wrapper

#### 2.2 Compiler Package Changes

**Headless compilation mode**:

```typescript
// @aprovan/patchwork-compiler
export interface CompileOptions {
  // ... existing
  headless?: boolean;  // Return module without DOM dependencies for Node.js
}

export interface HeadlessCompileResult {
  code: string;        // Compiled ESM
  css?: string;        // Extracted styles
  imports: string[];   // External dependencies
}
```

This enables the extension to:
1. Pre-compile code in the extension host
2. Send compiled bundle to webview (faster reload)
3. Surface compile errors in VS Code's Problems panel

#### 2.3 Create `@aprovan/patchwork-vscode-common`

Shared types and utilities for extension-webview communication:

```typescript
// packages/vscode-common/src/index.ts
export interface ExtensionToWebviewMessage {
  type: 'compile' | 'updateFile' | 'setServices' | 'setColorScheme' | 'serviceResult';
  payload: unknown;
}

export interface WebviewToExtensionMessage {
  type: 'ready' | 'compileError' | 'compileSuccess' | 'editRequest' | 'saveRequest' | 'serviceCall';
  payload: unknown;
}

export interface PatchworkProjectState {
  projectId: string;
  activeFile: string;
  files: Array<{ path: string; content: string; encoding: 'utf8' | 'base64' }>;
  services: string[];
  colorScheme: 'light' | 'dark';
}

export interface ServiceCallMessage {
  id: string;           // Correlation ID for response
  namespace: string;    // e.g., 'github'
  procedure: string;    // e.g., 'repos_list_for_user'
  args: Record<string, unknown>;
}

export interface ServiceResultMessage {
  id: string;
  result?: unknown;
  error?: string;
}
```

### Phase 3: LLM Integration

#### 3.1 Copilot Proxy Configuration

**Settings UI**:
- `patchwork.copilotProxyUrl` - URL to running proxy
- Status bar item showing connection state
- Command `patchwork.testConnection` to verify proxy is reachable

**Connection flow**:
1. Extension checks proxy health on activation: `GET {proxyUrl}/health`
2. If unreachable, show notification with "Start Proxy" action
3. "Start Proxy" opens terminal and runs `npx @aprovan/copilot-proxy serve`

#### 3.2 Edit API Integration

**Direct API calls from extension** (no separate stitchery server needed):

```typescript
// src/services/EditService.ts
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { streamText } from 'ai';
import { EDIT_PROMPT } from '@aprovan/patchwork-stitchery';

export class EditService {
  constructor(private copilotProxyUrl: string) {}
  
  async *streamEdit(code: string, prompt: string): AsyncGenerator<string> {
    const provider = createOpenAICompatible({
      name: 'copilot-proxy',
      baseURL: this.copilotProxyUrl,
    });
    
    const result = streamText({
      model: provider('claude-sonnet-4'),
      system: EDIT_PROMPT,
      messages: [{ role: 'user', content: `Code:\n${code}\n\nEdit: ${prompt}` }],
    });
    
    for await (const chunk of result.textStream) {
      yield chunk;
    }
  }
}
```

#### 3.3 Embedded Stitchery for Services

Rather than requiring a separate stitchery server process, embed the service registry directly in the extension host:

```typescript
// src/services/EmbeddedStitchery.ts
import { ServiceRegistry } from '@aprovan/patchwork-stitchery';
import { createUtcpBackend } from '@aprovan/patchwork-utcp';
import { createMCPClient } from '@ai-sdk/mcp';
import type { ServiceCallMessage, ServiceResultMessage } from '@aprovan/patchwork-vscode-common';

export class EmbeddedStitchery {
  private registry: ServiceRegistry;
  
  async initialize(utcpConfig?: object, mcpServers?: McpServerConfig[]): Promise<void> {
    this.registry = new ServiceRegistry();
    
    // Register UTCP services if configured
    if (utcpConfig) {
      const { toolInfos } = await createUtcpBackend(utcpConfig);
      for (const tool of toolInfos) {
        this.registry.registerTool(tool);
      }
    }
    
    // Register MCP servers if configured
    for (const server of mcpServers ?? []) {
      const client = await createMCPClient({ /* ... */ });
      this.registry.registerTools(await client.tools(), server.name);
    }
  }
  
  async handleServiceCall(msg: ServiceCallMessage): Promise<ServiceResultMessage> {
    try {
      const result = await this.registry.callTool(msg.namespace, msg.procedure, msg.args);
      return { id: msg.id, result };
    } catch (err) {
      return { id: msg.id, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  }
  
  getNamespaces(): string[] {
    return this.registry.getNamespaces();
  }
}
```

**Service call flow**:
1. Widget calls `services.github.repos_list_for_user({ username: 'foo' })`
2. Webview intercepts via injected service proxy, sends `postMessage({ type: 'serviceCall', payload: {...} })`
3. Extension host receives, routes to `EmbeddedStitchery.handleServiceCall()`
4. Result sent back via `postMessage({ type: 'serviceResult', payload: {...} })`
5. Webview resolves the original promise

#### 3.4 Edit UI in Webview

The webview includes a minimal edit interface:
- Input field at bottom for edit prompts
- Streaming response display
- Diff preview before applying
- History panel (collapsible)

This reuses logic from `useEditSession` but adapted for webview messaging.

### Phase 4: File System Integration

#### 4.1 Virtual File System Provider

Implement `FileSystemProvider` for `patchwork://` URI scheme:

```typescript
// src/providers/PatchworkFileSystemProvider.ts
export class PatchworkFileSystemProvider implements vscode.FileSystemProvider {
  private projects: Map<string, VirtualProject> = new Map();
  
  // Maps patchwork://projectId/path/to/file.tsx to VirtualFile
  readFile(uri: vscode.Uri): Uint8Array { /* ... */ }
  writeFile(uri: vscode.Uri, content: Uint8Array): void { /* ... */ }
  
  // Sync changes back to in-memory project
}
```

**URI format**: `patchwork://project-id/src/components/Button.tsx`

#### 4.2 Document Sync

Keep VS Code editor and Patchwork project in sync:

```typescript
// On text document change
vscode.workspace.onDidChangeTextDocument((e) => {
  if (e.document.uri.scheme === 'patchwork') {
    const { projectId, filePath } = parseUri(e.document.uri);
    this.updateProjectFile(projectId, filePath, e.document.getText());
    this.previewPanel.refresh();
  }
});
```

#### 4.3 Save to Disk

Command to export Patchwork project to real filesystem:

```typescript
// Command: patchwork.exportProject
async function exportProject(projectId: string, targetDir: vscode.Uri): Promise<void> {
  const project = this.getProject(projectId);
  for (const [path, file] of project.files) {
    const targetPath = vscode.Uri.joinPath(targetDir, path);
    await vscode.workspace.fs.writeFile(targetPath, Buffer.from(file.content));
  }
}
```

### Phase 5: Preview & Compilation

#### 5.1 Preview Panel Architecture

Single shared preview panel that follows the active editor:

```
┌─────────────────────────────────────────────────────────────┐
│  VS Code Extension Host                                     │
│  ┌─────────────────────────────────────────────────────────┤
│  │  PreviewPanelProvider (singleton)                       │
│  │  - Single WebviewPanel, follows active editor           │
│  │  - Sends code updates via postMessage                   │
│  │  - Receives compile errors, edit requests               │
│  ├─────────────────────────────────────────────────────────┤
│  │  EmbeddedStitchery                                      │
│  │  - ServiceRegistry for UTCP/MCP tools                   │
│  │  - Routes webview service calls to backends             │
│  │  - EditService for LLM-powered code edits               │
│  └─────────────────────────────────────────────────────────┤
│                           │ postMessage                     │
├───────────────────────────┼─────────────────────────────────┤
│  Webview (sandboxed)      ▼                                 │
│  ┌─────────────────────────────────────────────────────────┤
│  │  React App (pre-bundled with esbuild)                   │
│  │  - createCompiler() from @aprovan/patchwork-compiler    │
│  │  - Renders compiled widget                              │
│  │  - Service calls → postMessage → extension host         │
│  │  - EditInputBar for AI edits                            │
│  │  - EditHistory panel                                    │
│  │  - Respects colorScheme: 'light' | 'dark'               │
│  └─────────────────────────────────────────────────────────┤
└─────────────────────────────────────────────────────────────┘
```

**Active editor tracking**:
```typescript
// PreviewPanelProvider.ts
vscode.window.onDidChangeActiveTextEditor((editor) => {
  if (editor && this.isPreviewableFile(editor.document.uri)) {
    this.updatePreview(editor.document);
  }
});

vscode.window.onDidChangeActiveColorTheme((theme) => {
  const colorScheme = theme.kind === vscode.ColorThemeKind.Dark ? 'dark' : 'light';
  this.panel?.webview.postMessage({ type: 'setColorScheme', payload: colorScheme });
});
```

#### 5.2 Supported File Types

| Extension | Behavior |
|-----------|----------|
| `.tsx`, `.jsx` | Compile with patchwork-compiler, show in preview panel |
| `.ts`, `.js` | Open in VS Code editor, no preview |
| `.md` | Open in VS Code editor, use VS Code's markdown preview |
| `.css`, `.json` | Open in VS Code editor |
| Images | Show in preview panel using `MediaPreview` component |

#### 5.3 Error Handling

Compilation errors surface in multiple places:
1. **Preview panel**: Inline error display with stack trace
2. **Problems panel**: `vscode.languages.createDiagnosticCollection('patchwork')`
3. **Editor decorations**: Squiggles on error lines

### Phase 6: Polish & UX

#### 6.1 Status Bar

```typescript
const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
statusBar.text = '$(plug) Patchwork';
statusBar.tooltip = 'Copilot Proxy: Connected';
statusBar.command = 'patchwork.showConnectionStatus';
```

States:
- `$(plug)` Connected (green)
- `$(debug-disconnect)` Disconnected (red)
- `$(sync~spin)` Connecting...

#### 6.2 Code Actions

Register quick fixes for common scenarios:

```typescript
vscode.languages.registerCodeActionsProvider(['typescriptreact', 'javascriptreact'], {
  provideCodeActions(document, range, context) {
    return [
      {
        title: 'Edit with Patchwork AI',
        command: 'patchwork.editWithAI',
        arguments: [document.uri, range]
      }
    ];
  }
});
```

#### 6.3 Keyboard Shortcuts

| Shortcut | Command |
|----------|---------|
| `Cmd+Shift+Alt+P` | Show Patchwork Preview |
| `Cmd+Shift+Alt+E` | Edit with AI (selected code) |
| `Cmd+Shift+Alt+H` | Show Edit History |

---

## Package Dependencies

### `@aprovan/patchwork-vscode`

```json
{
  "dependencies": {
    "@aprovan/patchwork": "workspace:*",
    "@aprovan/patchwork-stitchery": "workspace:*",
    "@aprovan/patchwork-utcp": "workspace:*",
    "@ai-sdk/openai-compatible": "^0.1.0",
    "@ai-sdk/mcp": "^0.1.0",
    "ai": "^4.0.0"
  },
  "devDependencies": {
    "@types/vscode": "^1.85.0",
    "@vscode/vsce": "^2.22.0",
    "esbuild": "^0.20.0"
  }
}
```

### Webview Bundle

Pre-bundled React app (esbuild) including:
- `@aprovan/patchwork-compiler`
- `@aprovan/patchwork-editor` (EditHistory, EditInputBar components)
- `@aprovan/bobbin` (for visual editing)
- `@aprovan/patchwork-image-shadcn` (or configurable)
- Service proxy bridge that routes `services.*` calls through `postMessage` to extension host
- Light/dark mode support via CSS class toggle (`[data-theme="dark"]`)

---

## Development Milestones

### Milestone 1: Basic Extension (1-2 weeks)
- [x] Extension scaffold with activation
- [x] TreeDataProvider showing hardcoded project
- [x] Basic webview panel with "Hello World"
- [x] Configuration for Copilot proxy URL

### Milestone 2: Preview System (1-2 weeks)
- [x] Integrate patchwork-compiler in webview
- [x] Live preview of TSX files
- [x] Error display in preview and Problems panel
- [x] File selection syncs with preview

### Milestone 3: AI Editing (1-2 weeks)
- [x] Edit input in webview
- [x] Direct calls to Copilot proxy from extension
- [x] Streaming response display
- [x] Apply edits to document
- [x] Edit history panel
- [x] EmbeddedStitchery for service registration (UTCP/MCP)

### Milestone 4: File System (1 week)
- [x] PatchworkFileSystemProvider implementation
- [x] Persist patchwork:// saves to disk
- [x] Save/export to disk
- [x] Sync between editor and preview

### Milestone 5: Polish (1 week)
- [x] Status bar connection indicator
- [x] Code actions integration
- [x] Keyboard shortcuts
- [x] Documentation and README

---

## Design Decisions

1. **Webview bundling strategy**: Pre-bundle the webview with esbuild for offline capability and faster load. Fall back to CDN only if bundling proves overly complex.

2. **Multiple preview panels**: Single shared preview panel with file indicator that follows the active editor. No per-file preview panels.

3. **Service registration**: Embed Stitchery directly in the extension host to handle service calls. The webview communicates with the extension host via postMessage, which routes to the embedded Stitchery for UTCP/MCP service execution. Avoids requiring a separate background server process.

4. **Theme synchronization**: Minimal theming—only respect VS Code's dark/light mode preference. Pass `colorScheme: 'dark' | 'light'` to the webview based on `vscode.window.activeColorTheme.kind`. No CSS variable mapping.
