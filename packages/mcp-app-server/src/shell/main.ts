/**
 * Patchwork MCP App "shell".
 *
 * This is the document Claude loads as the MCP App resource. Per the MCP Apps
 * protocol the resource document itself must be the app that connects to the
 * host (`App.connect()` → `window.parent`); it runs under a strict CSP with no
 * `unsafe-eval`, so it cannot run the esbuild-wasm compiler.
 *
 * So the shell stays light: it runs the ext-apps {@link App} (handshake + sizing
 * + host bridge) and embeds the Patchwork runtime in a nested, CSP-free iframe
 * served from the widget host. The runtime compiles the widget in the browser
 * and mounts it; the widget's `window.patchwork.*` / service-namespace calls are
 * forwarded up here over postMessage and relayed to the host:
 *
 *   widget (runtime iframe) ──postMessage──▶ shell (App) ──ext-apps──▶ host
 */
import { App } from "@modelcontextprotocol/ext-apps";

interface ShellConfig {
  /** Base URL of the runtime host page, e.g. https://host/runtime/ */
  runtime: string;
  /** "<name>/<hash>" of the saved widget to render. */
  widget: string;
  /** Startup props passed to the widget. */
  inputs: Record<string, unknown>;
}

// Minimal MCP tool-result shape (avoids depending on SDK types in the bundle).
interface ToolResult {
  isError?: boolean;
  content?: Array<{ type: string; text?: string }>;
}

function readConfig(): ShellConfig {
  const el = document.currentScript as HTMLScriptElement | null;
  const raw = el?.dataset["config"] ?? "";
  try {
    const json = decodeURIComponent(escape(atob(raw)));
    return JSON.parse(json) as ShellConfig;
  } catch {
    return { runtime: "", widget: "", inputs: {} };
  }
}

function parseResult(result: ToolResult): unknown {
  const textBlock = result?.content?.find((c) => c.type === "text");
  if (textBlock?.text !== undefined) {
    try {
      return JSON.parse(textBlock.text);
    } catch {
      return textBlock.text;
    }
  }
  return result;
}

function boot(): void {
  const config = readConfig();

  const app = new App({ name: "patchwork-widget", version: "0.1.0" });

  // Nested, CSP-free runtime iframe (compiles + mounts the widget in-browser).
  const iframe = document.createElement("iframe");
  iframe.style.cssText = "width:100%;border:none;display:block;";
  iframe.setAttribute("sandbox", "allow-scripts allow-same-origin");
  const query = new URLSearchParams({
    widget: config.widget,
    inputs: JSON.stringify(config.inputs ?? {}),
  });
  iframe.src = `${config.runtime}?${query.toString()}`;
  (document.getElementById("pw-root") ?? document.body).appendChild(iframe);

  const post = (msg: Record<string, unknown>): void => {
    iframe.contentWindow?.postMessage({ source: "patchwork-host", ...msg }, "*");
  };

  // Per-stream cursor for live updates.
  const streams = new Map<string, number>();

  const pollStream = async (stream: string): Promise<void> => {
    const afterSeq = streams.get(stream) ?? 0;
    try {
      const res = (await app.callServerTool({
        name: "poll_updates",
        arguments: { stream, after_seq: afterSeq },
      })) as ToolResult;
      const parsed = parseResult(res) as { events?: Array<{ seq: number; data: unknown }> };
      if (!parsed?.events?.length) return;
      for (const ev of parsed.events) {
        if (ev.seq > (streams.get(stream) ?? 0)) streams.set(stream, ev.seq);
        post({ kind: "stream-event", stream, data: ev.data, seq: ev.seq });
      }
    } catch (err) {
      console.warn("[patchwork-shell] poll_updates failed:", err);
    }
  };

  const callTool = async (id: string, name: string, args: unknown): Promise<void> => {
    try {
      const res = (await app.callServerTool({
        name,
        arguments: (args as Record<string, unknown>) ?? {},
      })) as ToolResult;
      if (res.isError) {
        const text = res.content?.find((c) => c.type === "text")?.text;
        post({ kind: "result", id, ok: false, error: text ?? `Tool call failed: ${name}` });
      } else {
        post({ kind: "result", id, ok: true, value: parseResult(res) });
      }
    } catch (err) {
      post({ kind: "result", id, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  };

  window.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== iframe.contentWindow) return;
    const m = event.data as Record<string, unknown> | undefined;
    if (!m || m["source"] !== "patchwork") return;

    switch (m["kind"]) {
      case "size": {
        const h = m["height"];
        if (typeof h === "number" && h > 0) iframe.style.height = `${h}px`;
        break;
      }
      case "service":
        void callTool(m["id"] as string, `${m["namespace"]}__${m["procedure"]}`, m["args"]);
        break;
      case "fire":
        void callTool(m["id"] as string, m["toolName"] as string, m["args"]);
        break;
      case "subscribe": {
        const stream = m["stream"] as string;
        if (streams.has(stream)) break;
        streams.set(stream, 0);
        void app
          .callServerTool({ name: "subscribe_stream", arguments: { stream } })
          .then((res) => {
            const parsed = parseResult(res as ToolResult) as { seq?: number };
            if (typeof parsed?.seq === "number") streams.set(stream, parsed.seq);
          })
          .catch((err) => console.warn("[patchwork-shell] subscribe_stream failed:", err));
        break;
      }
      case "context": {
        const content = m["content"];
        const params =
          typeof content === "string"
            ? { content: [{ type: "text", text: content }] }
            : Array.isArray(content)
              ? { content }
              : { structuredContent: content as Record<string, unknown> };
        void app.updateModelContext(params).catch(() => {});
        break;
      }
    }
  });

  // When the server signals new data (notifications/tools/list_changed), poll
  // every subscribed stream and forward fresh events down to the widget.
  app.fallbackNotificationHandler = async (notification: { method: string }) => {
    if (notification.method === "notifications/tools/list_changed") {
      for (const stream of streams.keys()) await pollStream(stream);
    }
  };

  app.connect().catch((err) => {
    console.error("[patchwork-shell] failed to connect to host:", err);
  });
}

boot();
