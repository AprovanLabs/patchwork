# patchwork

![Aprovan Labs](https://raw.githubusercontent.com/AprovanLabs/aprovan.com/main/docs/assets/header-labs.svg)
<br />
<a href="https://aprovan.com">
<img height="20" src="https://img.shields.io/badge/aprovan.com-ef4444?style=flat-square" alt="aprovan.com">
</a>
<a href="https://github.com/AprovanLabs">
<img height="20" src="https://img.shields.io/badge/-AprovanLabs-000000?style=flat-square&logo=GitHub&logoColor=white&link=https://github.com/AprovanLabs/" alt="Aprovan Labs GitHub" />
</a>
<a href="https://www.linkedin.com/company/aprovan">
<img height="20" src="https://img.shields.io/badge/-Aprovan-blue?style=flat-square&logo=Linkedin&logoColor=white&link=https://www.linkedin.com/company/aprovan)" alt="Aprovan LinkedIn">
</a>

Platform for building generative UI experiences

## Architecture

- `@aprovan/patchwork-main` is the MCP-only runtime client.
- `@aprovan/patchwork-mcp` publishes Patchwork widgets as MCP Apps and forwards
  toolbox calls to the configured Streamable HTTP MCP endpoint.
- `@aprovan/patchwork-web` is the static `/chat/` browser shell. It calls the
  gateway directly and stores workspace files in OPFS.
- Compiler, editor, image, and Bobbin packages remain framework-neutral.

Local development requires only the web shell and a gateway:

```bash
GATEWAY_URL=http://localhost:4000 pnpm --filter @aprovan/patchwork-web dev
```

## Cicadas

Install Cicadas

```bash
$> uv venv .venv
$> source .venv/bin/activate
$> uv pip install aprovan-cicadas
$> cicadas
```
