/**
 * Env-gated local links for cross-repo @aprovan packages.
 *
 * The normal flow is publish-then-consume (push to GitHub, actions publish,
 * bump here). While iterating on a sibling repo, skip the round trip:
 *
 *   APROVAN_LOCAL_LINKS=1 pnpm install
 *
 * rewrites the published deps below to `link:` the sibling checkouts
 * (pnpm re-resolves them as workspace-style links; a plain `pnpm install`
 * restores the registry versions). Requires the linked packages to be
 * built locally (`pnpm build` in each).
 */

const path = require("node:path");

// `link:` targets resolve relative to each consuming package, so compute
// absolute paths from the repo root (this file's directory) instead.
const sibling = (relative) => `link:${path.resolve(__dirname, "..", relative)}`;

const LOCAL_LINKS = {
  "@aprovan/ui": sibling("core/packages/ui"),
  "@aprovan/registry-ui": sibling("registry/packages/registry-ui"),
  "@aprovan/registry-main": sibling("registry/packages/registry-main"),
};

function readPackage(pkg) {
  if (process.env.APROVAN_LOCAL_LINKS !== "1") return pkg;
  for (const field of ["dependencies", "devDependencies"]) {
    const deps = pkg[field];
    if (!deps) continue;
    for (const [name, target] of Object.entries(LOCAL_LINKS)) {
      if (deps[name]) deps[name] = target;
    }
  }
  return pkg;
}

module.exports = { hooks: { readPackage } };
