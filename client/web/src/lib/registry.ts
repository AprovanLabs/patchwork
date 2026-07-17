/**
 * Deep links into the registry web app — the harness for every
 * patchwork → registry hand-off (credentials, provider pages).
 *
 * `VITE_REGISTRY_URL` overrides the base; dev defaults to the local Astro
 * dev server so local patchwork never bounces to production aprovan.com.
 */

const REGISTRY_BASE = (
  (import.meta.env["VITE_REGISTRY_URL"] as string | undefined) ??
  (import.meta.env.DEV
    ? "http://localhost:4321"
    : "https://aprovan.com/registry")
).replace(/\/$/, "");

export function registryUrl(path = "/"): string {
  return `${REGISTRY_BASE}${path}`;
}

/** Credentials page; pass a provider id to preselect it in the add form. */
export function credentialsUrl(provider?: string): string {
  const query = provider ? `?provider=${encodeURIComponent(provider)}` : "";
  return registryUrl(`/account/credentials/${query}`);
}
