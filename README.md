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

## VS Code extension quickstart

1. Install dependencies from the repo root:

```sh
pnpm install
```

2. Build the VS Code extension package:

```sh
pnpm -F @aprovan/patchwork-vscode build
```

3. Open the repo in VS Code and run the extension:

- Open the Run and Debug panel.
- Choose "Run Extension" (or "Extension"), then start debugging.

4. (Optional) Configure Copilot proxy for AI edits:

- Start the proxy: `npx @aprovan/copilot-proxy serve --port 3000`
- In VS Code settings, set `patchwork.copilotProxyUrl` to `http://localhost:3000`
