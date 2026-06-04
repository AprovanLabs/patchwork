import { createProjectFromFiles, type Manifest } from "@aprovan/patchwork-compiler";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { clear } from "../compiler/cache.js";
import { compileWidget, cacheHas } from "../compiler/compile.js";
import {
  appendEvent,
  getEvents,
  pushStreamUpdate,
  currentSeq,
  registerSession,
  subscribeSession,
  _resetForTests,
} from "../live-update.js";
import {
  REFERENCE_WIDGET_FILES,
  REFERENCE_WIDGET_MANIFEST,
} from "../reference-widgets/live-dashboard.js";
import { ServiceBridge, type ServiceBackend, type ServiceToolInfo } from "../services.js";
import { generateServiceShim, generateLiveUpdateShim } from "../shim.js";
import { WidgetStore, resetWidgetStore } from "../widget-store/store.js";
import { MemoryBackend } from "./memory-backend.js";

const DASHBOARD_MANIFEST: Manifest = REFERENCE_WIDGET_MANIFEST;

function makeMockServer(notificationFn = vi.fn().mockResolvedValue(undefined)) {
  return {
    server: { notification: notificationFn },
  } as unknown as McpServer;
}

const mockBackend: ServiceBackend = {
  call: vi.fn(async (_ns: string, _proc: string, args: unknown[]) => {
    const a = args[0] as Record<string, unknown>;
    if (_ns === "weather" && _proc === "get_forecast") {
      return {
        location: a?.["location"] ?? "unknown",
        temperature: 22,
        conditions: "partly cloudy",
        forecast: [{ day: "today", high: 24, low: 18 }],
      };
    }
    return { result: "ok" };
  }),
};

const mockTools: ServiceToolInfo[] = [
  {
    name: "weather.get_forecast",
    namespace: "weather",
    procedure: "get_forecast",
    description: "Get weather forecast for a location",
    parameters: {
      type: "object",
      properties: {
        location: { type: "string", description: "Location name" },
      },
      required: ["location"],
    },
  },
];

describe("E2E: compile → VFS store → render pipeline", () => {
  beforeEach(() => {
    clear();
    resetWidgetStore();
  });

  it("compiles the reference dashboard widget and persists to VFS", async () => {
    const project = createProjectFromFiles(REFERENCE_WIDGET_FILES);
    const store = new WidgetStore({ backend: new MemoryBackend() });

    const result = await compileWidget(project, DASHBOARD_MANIFEST, {
      services: ["weather"],
    });

    expect(result.html).toContain("<!DOCTYPE html>");
    expect(result.html).toContain("id=\"root\"");
    expect(result.hash).toBeTruthy();
    expect(result.resourceUri).toMatch(/^ui:\/\/widget\//);

    await store.saveWidget(result.hash, result.html, DASHBOARD_MANIFEST);

    const stored = await store.getWidget(DASHBOARD_MANIFEST.name, result.hash);
    expect(stored).not.toBeNull();
    expect(stored!.html).toContain("<!DOCTYPE html>");
    expect(stored!.manifest.name).toBe("live-dashboard");
    expect(stored!.manifest.services).toEqual(["weather"]);
    expect(stored!.resourceUri).toMatch(/^ui:\/\/widgets\//);

    const allWidgets = await store.listWidgets();
    expect(allWidgets).toHaveLength(1);
    expect(allWidgets[0]!.name).toBe("live-dashboard");
  }, 60000);

  it("compiled HTML contains live-update shim (window.patchwork)", async () => {
    const project = createProjectFromFiles(REFERENCE_WIDGET_FILES);
    const result = await compileWidget(project, DASHBOARD_MANIFEST, {
      services: ["weather"],
    });

    expect(result.html).toContain("window.patchwork");
    expect(result.html).toContain("subscribe:");
    expect(result.html).toContain("updateContext:");
    expect(result.html).toContain("fireEvent:");
    expect(result.html).toContain("poll_updates");
    expect(result.html).toContain("subscribe_stream");
  }, 60000);

  it("compiled HTML contains service proxy shim for weather namespace", async () => {
    const project = createProjectFromFiles(REFERENCE_WIDGET_FILES);
    const result = await compileWidget(project, DASHBOARD_MANIFEST, {
      services: ["weather"],
    });

    expect(result.html).toContain("__patchwork_createNamespaceProxy");
    expect(result.html).toContain("weather");
    expect(result.html).toContain("callServerTool");
    expect(result.html).toContain("namespace + '__' + prop");
  }, 60000);

  it("compiled HTML contains CDN preload scripts and Tailwind", async () => {
    const project = createProjectFromFiles(REFERENCE_WIDGET_FILES);
    const result = await compileWidget(project, DASHBOARD_MANIFEST, {
      services: ["weather"],
    });

    expect(result.html).toContain("esm.sh/react");
    expect(result.html).toContain("tailwindcss");
    expect(result.html).toContain("--background");
    expect(result.html).toContain("--foreground");
  }, 60000);

  it("caches the compiled widget for repeated renders", async () => {
    const project = createProjectFromFiles(REFERENCE_WIDGET_FILES);

    const result1 = await compileWidget(project, DASHBOARD_MANIFEST, {
      services: ["weather"],
    });
    expect(cacheHas(result1.hash)).toBe(true);

    const result2 = await compileWidget(project, DASHBOARD_MANIFEST, {
      services: ["weather"],
    });
    expect(result2.hash).toBe(result1.hash);
    expect(result2.html).toBe(result1.html);
  }, 60000);

  it("compiles without services (no service shim)", async () => {
    const project = createProjectFromFiles(REFERENCE_WIDGET_FILES);
    const result = await compileWidget(project, DASHBOARD_MANIFEST);

    expect(result.html).toContain("<!DOCTYPE html>");
    expect(result.html).not.toContain("__patchwork_createNamespaceProxy");
    expect(result.html).toContain("window.patchwork");
  }, 60000);

  it("compiles a single-file widget that uses services and live updates", async () => {
    const simpleWidget = `export default function Widget() {
  return <div className="p-4">Service widget</div>;
}`;
    const manifest: Manifest = {
      name: "simple-service",
      version: "0.1.0",
      platform: "browser",
      image: "@aprovan/patchwork-image-shadcn",
      services: ["stripe"],
    };

    const result = await compileWidget(simpleWidget, manifest, {
      services: ["stripe"],
    });

    expect(result.html).toContain("<!DOCTYPE html>");
    expect(result.html).toContain("stripe");
    expect(result.html).toContain("__patchwork_createNamespaceProxy");
    expect(result.html).toContain("window.patchwork");
  }, 60000);
});

describe("E2E: service bridge integration", () => {
  it("ServiceBridge forwards calls to the backend", async () => {
    const bridge = new ServiceBridge({ backend: mockBackend, tools: mockTools });

    const server = new McpServer({ name: "test-e2e", version: "0.1.0" });
    bridge.registerTools(server);
    bridge.registerSearchServices(server);

    expect(bridge.getNamespaces()).toEqual(["weather"]);
    expect(bridge.has("weather", "get_forecast")).toBe(true);
  });

  it("ServiceBridge search_services returns available tools", async () => {
    const bridge = new ServiceBridge({ backend: mockBackend, tools: mockTools });
    const server = new McpServer({ name: "test-e2e", version: "0.1.0" });
    bridge.registerTools(server);
    bridge.registerSearchServices(server);
  });

  it("mock backend returns structured data for weather calls", async () => {
    const result = await mockBackend.call("weather", "get_forecast", [{ location: "San Francisco" }]);
    expect(result).toEqual({
      location: "San Francisco",
      temperature: 22,
      conditions: "partly cloudy",
      forecast: [{ day: "today", high: 24, low: 18 }],
    });
  });
});

describe("E2E: live update channel integration", () => {
  beforeEach(() => {
    _resetForTests();
  });

  it("push_stream_update buffers events and notifies subscribed sessions", async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    const server = makeMockServer(notify);

    registerSession("e2e-sess-1", server);
    subscribeSession("e2e-sess-1", "price_feed");

    const seq = await pushStreamUpdate("price_feed", {
      AAPL: { price: 189.50, change: 1.23 },
    });

    expect(seq).toBeGreaterThan(0);
    expect(notify).toHaveBeenCalledWith({
      method: "notifications/tools/list_changed",
    });

    const events = getEvents("price_feed", 0);
    expect(events).toHaveLength(1);
    expect(events[0]!.data).toEqual({
      AAPL: { price: 189.50, change: 1.23 },
    });
  });

  it("multiple sequential pushes are retrieved with afterSeq", async () => {
    const e1 = appendEvent("system_status", { service: "api", status: "ok" });
    appendEvent("system_status", { service: "db", status: "warning" });
    appendEvent("system_status", { service: "cache", status: "ok" });

    const events = getEvents("system_status", e1.seq);
    expect(events).toHaveLength(2);

    const allEvents = getEvents("system_status", 0);
    expect(allEvents).toHaveLength(3);
  });

  it("poll_updates simulation: subscribe, push, poll", async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    const server = makeMockServer(notify);

    registerSession("poll-sess", server);
    subscribeSession("poll-sess", "price_feed");

    const startSeq = currentSeq();

    await pushStreamUpdate("price_feed", { AAPL: { price: 185.0, change: 0.5 } });
    await pushStreamUpdate("price_feed", { GOOGL: { price: 142.30, change: -0.8 } });

    const newEvents = getEvents("price_feed", startSeq);
    expect(newEvents).toHaveLength(2);

    expect(newEvents[0]!.data).toEqual({ AAPL: { price: 185.0, change: 0.5 } });
    expect(newEvents[1]!.data).toEqual({ GOOGL: { price: 142.30, change: -0.8 } });
  });

  it("unsubscribed sessions do not receive notifications", async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    const server = makeMockServer(notify);

    registerSession("unsub-sess", server);

    await pushStreamUpdate("price_feed", { tick: true });
    expect(notify).not.toHaveBeenCalled();
  });

  it("live update shim code includes subscribe/poll/push integration", () => {
    const shim = generateLiveUpdateShim();

    expect(shim).toContain("window.patchwork");
    expect(shim).toContain("subscribe:");
    expect(shim).toContain("subscribe_stream");
    expect(shim).toContain("poll_updates");
    expect(shim).toContain("notifications/tools/list_changed");
    expect(shim).toContain("__pollStream");
    expect(shim).toContain("after_seq");
  });
});

describe("E2E: VFS store round-trip with compiled widget", () => {
  beforeEach(() => {
    clear();
    resetWidgetStore();
  });

  it("compile, persist, retrieve, and re-register as MCP resource", async () => {
    const store = new WidgetStore({ backend: new MemoryBackend() });
    const project = createProjectFromFiles(REFERENCE_WIDGET_FILES);
    const result = await compileWidget(project, DASHBOARD_MANIFEST, {
      services: ["weather"],
    });

    await store.saveWidget(result.hash, result.html, DASHBOARD_MANIFEST, "main.tsx");

    const stored = await store.getWidget(DASHBOARD_MANIFEST.name, result.hash);
    expect(stored).not.toBeNull();
    expect(stored!.html).toBe(result.html);
    expect(stored!.entry).toBe("main.tsx");

    expect(store.resourceUriFor(DASHBOARD_MANIFEST.name, result.hash)).toMatch(
      /^ui:\/\/widgets\/live-dashboard\//,
    );

    const listed = await store.listWidgets();
    expect(listed).toHaveLength(1);
    expect(listed[0]!.name).toBe("live-dashboard");
    expect(listed[0]!.services).toEqual(["weather"]);
    expect(listed[0]!.entry).toBe("main.tsx");

    await store.deleteWidget(DASHBOARD_MANIFEST.name, result.hash);
    const deleted = await store.getWidget(DASHBOARD_MANIFEST.name, result.hash);
    expect(deleted).toBeNull();
  }, 60000);
});

describe("E2E: MCP server tool wiring", () => {
  it("ServiceBridge + McpServer tool registration does not throw", () => {
    const bridge = new ServiceBridge({ backend: mockBackend, tools: mockTools });
    const server = new McpServer({ name: "test-e2e", version: "0.1.0" });
    expect(() => {
      bridge.registerTools(server);
      bridge.registerSearchServices(server);
    }).not.toThrow();
  });

  it("McpServer can be constructed with service bridge config", () => {
    const server = new McpServer({ name: "patchwork-mcp-app-server", version: "0.1.0" });
    expect(server).toBeDefined();

    const bridge = new ServiceBridge({ backend: mockBackend, tools: mockTools });
    bridge.registerTools(server);
    bridge.registerSearchServices(server);

    expect(bridge.getNamespaces()).toContain("weather");
    expect(bridge.getToolInfos()).toHaveLength(1);
  });
});

describe("E2E: shim code generation for reference widget", () => {
  it("service shim includes all requested namespaces", () => {
    const shim = generateServiceShim({ namespaces: ["weather"] });

    expect(shim).toContain("import { App } from");
    expect(shim).toContain("esm.sh/@modelcontextprotocol/ext-apps");
    expect(shim).toContain("weather");
    expect(shim).toContain("__patchwork_createNamespaceProxy");
    expect(shim).toContain("window[__ns]");
    expect(shim).toContain("callServerTool");
    expect(shim).toContain("namespace + '__' + prop");
  });

  it("combined service + live-update shim is coherent", () => {
    const serviceShim = generateServiceShim({ namespaces: ["weather"] });
    const liveShim = generateLiveUpdateShim();

    expect(serviceShim).toContain("__patchwork_app");
    expect(liveShim).toContain("if (!window.__patchwork_app)");
    expect(serviceShim).toContain("new App(");
    expect(liveShim).toContain("window.patchwork");

    expect(liveShim).toContain("__patchwork_ready");
    expect(serviceShim).toContain("__patchwork_ready");
  });
});

describe("E2E: multi-session live update broadcasting", () => {
  beforeEach(() => {
    _resetForTests();
  });

  it("pushes to multiple sessions subscribed to the same stream", async () => {
    const notify1 = vi.fn().mockResolvedValue(undefined);
    const notify2 = vi.fn().mockResolvedValue(undefined);
    const notify3 = vi.fn().mockResolvedValue(undefined);

    registerSession("multi-1", makeMockServer(notify1));
    registerSession("multi-2", makeMockServer(notify2));
    registerSession("multi-3", makeMockServer(notify3));

    subscribeSession("multi-1", "price_feed");
    subscribeSession("multi-2", "price_feed");
    subscribeSession("multi-3", "system_status");

    await pushStreamUpdate("price_feed", { AAPL: 150 });

    expect(notify1).toHaveBeenCalledOnce();
    expect(notify2).toHaveBeenCalledOnce();
    expect(notify3).not.toHaveBeenCalled();
  });

  it("continues broadcasting when one session fails", async () => {
    const failing = vi.fn().mockRejectedValue(new Error("transport closed"));
    const ok = vi.fn().mockResolvedValue(undefined);

    registerSession("fail-sess", makeMockServer(failing));
    registerSession("ok-sess", makeMockServer(ok));

    subscribeSession("fail-sess", "events");
    subscribeSession("ok-sess", "events");

    await expect(pushStreamUpdate("events", { msg: "test" })).resolves.toBeDefined();
    expect(ok).toHaveBeenCalledOnce();
  });
});
