# @aprovan/patchwork-mcp

MCP Apps server for publishing Patchwork widgets.

The server connects to one configured MCP toolbox over Streamable HTTP. It
forwards tool calls through that toolbox and reads generated artifacts through
the toolbox resource API.

```sh
TOOLBOX_MCP_URL=https://aprovan.com/api/mcp \
TOOLBOX_TOKEN=... \
pnpm --filter @aprovan/patchwork-mcp dev
```

`APROVAN_WORKSPACE_ID` is forwarded as `X-Aprovan-Workspace` when set.
