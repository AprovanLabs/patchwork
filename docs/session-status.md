# Platform session status

Working log for the cross-repo platform work (chat, registry, aprovan.com, core).
Updated as tasks land. Newest entries first.

## Round 2 — feedback fixes + apps primitive (2026-07-19, complete)

| # | Task | Status |
| --- | --- | --- |
| 6 | aprovan.com/registry styling regression (prod) | done — root cause: a manual registry build without `PUBLIC_BASE_PATH=/registry` was deployed with SKIP_BUILD=1; assets pointed at `/_astro`. Redeployed via the script. |
| 7 | Chat dialog transparency over widgets; workflows → native group | done — heavier blurred scrim on dialogs; widget iframes now inherit the host theme (`.dark` propagated, image `setup(root, { darkMode })`); `workflows` added to ServicesMenu NATIVE_GROUPS. Deployed. |
| 8 | aprovan.com: waves hero, original tone, no red eyebrow, "Other projects" | done and deployed — **but see the repo note below**. |
| 9 | Chat: workflows explorer in left sidebar (first-party) | done — WorkflowsExplorer under the file tree: trigger icons, last-run dot, run-now, opens the shared panel. Deployed. |
| 10 | Example workflow: daily GitHub status cron | done — `scheduled/github-status.js` in ws_jacob_personal, registered `github-status` (cron `0 13 * * *` UTC). E2E-validated with real credentials: GitHub → synthetic.new summary → `status/AprovanLabs.md` (run succeeded, 8 spans). EventBridge minute tick provisioned (rule `registry-prd-use2-gateway-cron-tick`), so prod cron actually fires. |
| 11 | Apps primitive + LIIFT4 example | done — see below. Deployed. |

### ⚠ aprovan.com repo was reset by the user

While this session was interrupted, the aprovan.com repo was reset to its
original CRA history (`7dfd391 Remove unused infra code`); the Vite rebuild
and wave-hero commits are no longer in branch history. Respecting that, no
further changes or deploys were made to aprovan.com from this session. Note
the mismatch: **the live site at the aprovan.com root still serves the
rebuilt Vite version** (deployed before the reset). To put the original CRA
site back live, build it and sync to the bucket root; to recover the rebuilt
version, the orphaned commits are findable via `git reflog` ("Rebuild
aprovan.com as the Aprovan platform home", "Bring back the wave hero…").

### Apps primitive (task 11) — what shipped

- `apps` core service (publish/list/get/remove) — rides tool discovery, so
  chat can publish apps conversationally.
- Manifest: `{ name, title, widget_path, workflows[], allowed_tools[],
  roles { admins, access: any|listed, users }, rate_limit { rps, burst } }`
  at `.services/apps/<name>.json` in the owner workspace.
- Public surface `/apps/:ws/:name` (token auth, NO workspace membership):
  manifest, widget page (in-browser patchwork compile; calls proxied with
  the viewer's token), allow-list-gated tool dispatch, bundled-workflow runs.
- Per-(app, user) data partitioning via `ServiceContext.appScope` — keyvalue
  keys transparently scoped to `app:<app>:<sub>:…`; app-run workflows
  inherit the scope. Per-user token-bucket rate limits from the manifest.
- Gateway `{data, meta}` envelope now unwrapped in the patchwork compiler
  bridge, so widgets, playground scripts, and workflow scripts all see the
  same clean result shape.
- Example app: **LIIFT4 Tracker** (`registry/apps/gateway/examples/
  liift4-widget.tsx`) published to ws_jacob_personal as
  `apps/liift4/widget.tsx`; per-user isolation validated against the prod
  store (alice/bob/owner all distinct).
  Widget: https://aprovan.com/api/gateway/apps/ws_jacob_personal/liift4/widget
- Tests: `tests/apps.test.ts` (8) — publish/validate, manifest, partition
  isolation, allow-list denial, listed-access roles, per-user rate limits,
  app workflow runs. Full gateway suite green.

### Also in round 2

- `openrouter` added as an LLM chat-provider alias.
- Workflow runner: 180s script budget; dotted namespaces get sanitized
  aliases (`synthetic_new`) as script globals.

## Round 1 — shipped (2026-07-19)

- Widget style isolation: iframe mounts + patchwork-image-shadcn 0.1.2 (Play CDN
  config post-load fix). Deployed.
- Gateway: LLM aliases (synthetic.new et al) exposed + executable as tools. Deployed.
- aprovan.com rebuilt (Vite + @aprovan/ui), shared AppHeader across home/chat/registry
  (@aprovan/ui 0.3.1). Deployed. Incident: root deploy's S3 filter ordering deleted
  sibling app HTML; restored + script fixed (protective excludes last).
- Workflows engine in gateway (register/run/trace, webhook/cron/event triggers),
  shared WorkflowsPanel + TailorFlow (@aprovan/registry-ui 0.2.3), chat + registry
  integration. Deployed. Gateway tests green.
- Docs: registry/docs/platform.md (system map incl. apps), patchwork/docs/platform.md.

## Loose ends

- Git pushes not done anywhere (all commits local, by design).
- posthog MCP plugin needs OAuth (interactive session) before its tools work.
- Future apps work: credential grants across workspaces, app directory UI,
  admin cross-partition tooling, richer keyvalue queries.
