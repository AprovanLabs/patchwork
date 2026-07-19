# Patchwork in the Aprovan platform

The full platform map — repo ownership, the workspace/tool-namespace/tools-proxy
primitives, workflows, shared UI, and deployment — lives in the registry repo:
[`registry/docs/platform.md`](https://github.com/AprovanLabs/registry/blob/main/docs/platform.md).

What patchwork owns, in that picture:

- **The chat product** (`client/web`) — a view over a workspace: the model's
  tool list, the services menu, widget SDK namespaces, and the workflows menu
  are all projections of the gateway's `GET /tools`.
- **The widget pipeline** — `@aprovan/patchwork-compiler` compiles fenced
  widget source and mounts it in **sandboxed iframes** (mode `iframe`), so the
  image runtime (Tailwind Play CDN, theme variables) never leaks into the host
  page. Images (`@aprovan/patchwork-image-*`) carry the runtime, prompt, and
  design docs.
- **Editor components** (`@aprovan/patchwork-editor`) — CodePreview supports an
  app-supplied `customPreview`; chat uses it to render workflow scripts
  (`workflows/*.js`) as a Tailor execution-flow graph
  (`@aprovan/registry-ui/tailor`).

Shared pieces patchwork consumes rather than owns:

- `@aprovan/ui` (core): AppHeader shell, auth client, gateway session client.
- `@aprovan/registry-ui` (registry): WorkflowsPanel, TailorFlow.

Rule: cross-repo consumption is only through published npm packages.
