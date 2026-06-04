import { describe, it, expect } from "vitest";
import { generateServiceShim, generateLiveUpdateShim } from "../shim.js";

describe("generateServiceShim", () => {
  it("returns empty string when namespaces is empty", () => {
    const result = generateServiceShim({ namespaces: [] });
    expect(result).toBe("");
  });

  it("generates shim code that imports App from esm.sh", () => {
    const result = generateServiceShim({ namespaces: ["weather"] });
    expect(result).toContain("import { App } from");
    expect(result).toContain("esm.sh/@modelcontextprotocol/ext-apps");
  });

  it("uses default ext-apps version when not specified", () => {
    const result = generateServiceShim({ namespaces: ["weather"] });
    expect(result).toContain("^1.7.3");
  });

  it("uses custom ext-apps version when specified", () => {
    const result = generateServiceShim({
      namespaces: ["weather"],
      extAppsVersion: "2.0.0",
    });
    expect(result).toContain("@modelcontextprotocol/ext-apps@2.0.0");
  });

  it("creates App instance and calls connect", () => {
    const result = generateServiceShim({ namespaces: ["weather"] });
    expect(result).toContain("new App(");
    expect(result).toContain(".connect()");
  });

  it("creates namespace proxies for each service", () => {
    const result = generateServiceShim({
      namespaces: ["weather", "stripe"],
    });
    expect(result).toContain('"weather"');
    expect(result).toContain('"stripe"');
    expect(result).toContain("__patchwork_createNamespaceProxy");
  });

  it("sets namespace proxies on window", () => {
    const result = generateServiceShim({ namespaces: ["weather"] });
    expect(result).toContain("window[__ns]");
  });

  it("proxy uses __ separator for tool names", () => {
    const result = generateServiceShim({ namespaces: ["weather"] });
    expect(result).toContain("namespace + '__' + prop");
  });

  it("proxy calls callServerTool", () => {
    const result = generateServiceShim({ namespaces: ["weather"] });
    expect(result).toContain("callServerTool");
  });

  it("handles isError responses by throwing", () => {
    const result = generateServiceShim({ namespaces: ["weather"] });
    expect(result).toContain("result.isError");
    expect(result).toContain("throw new Error");
  });

  it("parses JSON text content from results", () => {
    const result = generateServiceShim({ namespaces: ["weather"] });
    expect(result).toContain("JSON.parse(textContent.text)");
  });

  it("waits for app connection before making calls", () => {
    const result = generateServiceShim({ namespaces: ["weather"] });
    expect(result).toContain("__patchwork_ready.then");
  });

  it("handles connection failure gracefully", () => {
    const result = generateServiceShim({ namespaces: ["weather"] });
    expect(result).toContain(".catch");
    expect(result).toContain("Failed to connect");
  });
});

describe("generateLiveUpdateShim", () => {
  it("imports App from esm.sh ext-apps", () => {
    const shim = generateLiveUpdateShim();
    expect(shim).toContain("import { App } from");
    expect(shim).toContain("esm.sh/@modelcontextprotocol/ext-apps");
  });

  it("uses default ext-apps version when not specified", () => {
    const shim = generateLiveUpdateShim();
    expect(shim).toContain("^1.7.3");
  });

  it("uses custom ext-apps version when specified", () => {
    const shim = generateLiveUpdateShim({ extAppsVersion: "2.0.0" });
    expect(shim).toContain("@modelcontextprotocol/ext-apps@2.0.0");
  });

  it("guards against double App initialisation", () => {
    const shim = generateLiveUpdateShim();
    expect(shim).toContain("if (!window.__patchwork_app)");
  });

  it("exposes window.patchwork.subscribe", () => {
    const shim = generateLiveUpdateShim();
    expect(shim).toContain("subscribe:");
    expect(shim).toContain("subscribe_stream");
  });

  it("exposes window.patchwork.updateContext", () => {
    const shim = generateLiveUpdateShim();
    expect(shim).toContain("updateContext:");
    expect(shim).toContain("ui/update-model-context");
  });

  it("exposes window.patchwork.fireEvent", () => {
    const shim = generateLiveUpdateShim();
    expect(shim).toContain("fireEvent:");
    expect(shim).toContain("callServerTool");
  });

  it("registers a notifications/tools/list_changed handler for polling", () => {
    const shim = generateLiveUpdateShim();
    expect(shim).toContain("notifications/tools/list_changed");
    expect(shim).toContain("poll_updates");
  });

  it("poll_updates passes after_seq to avoid duplicates", () => {
    const shim = generateLiveUpdateShim();
    expect(shim).toContain("after_seq");
  });
});
