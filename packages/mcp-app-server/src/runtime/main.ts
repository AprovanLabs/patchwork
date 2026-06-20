/**
 * Patchwork widget runtime host.
 *
 * Runs inside the nested, CSP-free iframe embedded by the MCP App shell. It
 * fetches a saved widget's raw source and compiles + mounts it in the browser
 * using the shared `@aprovan/patchwork-compiler` runtime (esbuild-wasm) — the
 * same path the chat app uses.
 *
 * The widget is selected via query params written by the shell:
 *   /runtime/?widget=<name>/<hash>&inputs=<urlencoded-json>
 *
 * Service / live-update / context calls made by the widget go through the
 * bridge shim (window.patchwork.* and namespace.*), which forwards them to the
 * parent shell over postMessage; the shell relays to the MCP host.
 */
import {
  createCompiler,
  createProjectFromFiles,
  type Compiler,
  type Manifest,
  type VirtualFile,
} from "@aprovan/patchwork-compiler";
import { generateBridgeShim } from "../shim.js";

const CDN_BASE = "https://esm.sh";

interface WidgetRef {
  name: string;
  hash: string;
}

interface WidgetFilesResponse {
  files: VirtualFile[];
  entry: string;
  manifest: Manifest;
}

const statusEl = document.getElementById("pw-status");

function setStatus(message: string, isError = false): void {
  if (!statusEl) return;
  statusEl.textContent = message;
  if (isError) statusEl.setAttribute("data-error", "true");
  else statusEl.removeAttribute("data-error");
  statusEl.style.display = message ? "block" : "none";
}

/**
 * Execute the bridge shim in this window so `window.patchwork` and the service
 * namespace proxies exist before the widget mounts. Imported as a blob module so
 * execution completes before we continue.
 */
async function runShim(code: string): Promise<void> {
  if (!code.trim()) return;
  const blob = new Blob([code], { type: "application/javascript" });
  const url = URL.createObjectURL(blob);
  try {
    await import(/* @vite-ignore */ url);
  } catch (err) {
    console.warn("[patchwork-runtime] bridge shim failed to load:", err);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Report content height to the parent shell so it can size the iframe. */
function reportSize(): void {
  const height = Math.ceil(document.documentElement.getBoundingClientRect().height);
  window.parent.postMessage({ source: "patchwork", kind: "size", height }, "*");
}

let started = false;
const compilerCache = new Map<string, Promise<Compiler>>();

function getCompiler(image: string): Promise<Compiler> {
  let cached = compilerCache.get(image);
  if (!cached) {
    cached = createCompiler({
      image,
      // Services are bridged to the MCP host via the shim, not an HTTP proxy.
      proxyUrl: "",
      cdnBaseUrl: CDN_BASE,
      widgetCdnBaseUrl: CDN_BASE,
    });
    compilerCache.set(image, cached);
  }
  return cached;
}

async function render(widget: WidgetRef, inputs: Record<string, unknown>): Promise<void> {
  if (started) return;
  started = true;

  try {
    setStatus("Loading widget source…");
    const res = await fetch(
      `/widget/${encodeURIComponent(widget.name)}/${encodeURIComponent(widget.hash)}/files`,
    );
    if (!res.ok) throw new Error(`Failed to load widget files (${res.status})`);
    const { files, entry, manifest } = (await res.json()) as WidgetFilesResponse;

    const services = manifest.services ?? [];

    // Wire window.patchwork + service namespaces (forwarded to the host shell)
    // before mounting so the widget's calls resolve.
    await runShim(generateBridgeShim({ namespaces: services }));

    setStatus("Compiling widget…");
    const compiler = await getCompiler(manifest.image);

    const project = createProjectFromFiles(files, widget.name);
    if (entry) project.entry = entry;

    // Strip services from the manifest passed to the compiler so its built-in
    // HTTP-proxy namespace globals don't clobber the bridge shim's proxies.
    const compileManifest: Manifest = { ...manifest, services: undefined };
    const compiled = await compiler.compile(project, compileManifest);

    const root = document.getElementById("root");
    if (!root) throw new Error("Missing #root element");

    setStatus("");
    await compiler.mount(compiled, { target: root, mode: "embedded", inputs });

    // Report size now and on any subsequent layout change.
    reportSize();
    const ro = new ResizeObserver(() => reportSize());
    ro.observe(document.body);
  } catch (err) {
    started = false;
    console.error("[patchwork-runtime] render failed", err);
    const message = err instanceof Error ? err.message : String(err);
    setStatus(`Failed to render widget:\n${message}`, true);
    window.parent.postMessage({ source: "patchwork", kind: "error", error: message }, "*");
  }
}

// Render from query params: /runtime/?widget=<name>/<hash>&inputs=<json>
function renderFromQuery(): void {
  const params = new URLSearchParams(window.location.search);
  const widgetParam = params.get("widget");
  if (!widgetParam) {
    setStatus("No widget specified.", true);
    return;
  }
  const [name, hash] = widgetParam.split("/");
  if (!name || !hash) {
    setStatus("Invalid widget reference.", true);
    return;
  }

  let inputs: Record<string, unknown> = {};
  const inputsParam = params.get("inputs");
  if (inputsParam) {
    try {
      inputs = JSON.parse(inputsParam) as Record<string, unknown>;
    } catch {
      /* ignore malformed inputs */
    }
  }
  void render({ name, hash }, inputs);
}

renderFromQuery();
