import { describe, it, expect } from "vitest";
import { generateServiceShim } from "../shim.js";

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
