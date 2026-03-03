# Patchwork VS Code Extension

Patchwork Viewer is a VS Code extension for opening Patchwork projects, previewing widgets, and syncing edits back to disk.

## Commands

- `Patchwork: Open Project` (`patchwork.openProject`)
- `Patchwork: Export Project` (`patchwork.exportProject`)
- `Patchwork: Show Preview` (`patchwork.showPreview`)
- `Patchwork: Edit with AI` (`patchwork.editWithAI`)
- `Patchwork: Show Edit History` (`patchwork.showEditHistory`)
- `Patchwork: Test Copilot Proxy` (`patchwork.testConnection`)

## Settings

- `patchwork.copilotProxyUrl`: Base URL for the Copilot proxy server.
- `patchwork.mcpServers`: MCP server configs (name, command, args).
- `patchwork.utcpConfig`: UTCP configuration for service registration.

## Keybindings

- `Cmd+Shift+Alt+P`: Show Patchwork Preview
- `Cmd+Shift+Alt+E`: Edit with AI (selected code)
- `Cmd+Shift+Alt+H`: Show Edit History

## Development

```bash
pnpm --filter @aprovan/patchwork-vscode build
pnpm --filter @aprovan/patchwork-vscode dev
```
