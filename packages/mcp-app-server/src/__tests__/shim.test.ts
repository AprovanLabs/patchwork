import { describe, it, expect } from "vitest";
import { generateBridgeShim } from "../shim.js";

describe("generateBridgeShim", () => {
  it("exposes window.patchwork with subscribe/updateContext/fireEvent", () => {
    const shim = generateBridgeShim({ namespaces: [] });
    expect(shim).toContain("window.patchwork");
    expect(shim).toContain("subscribe:");
    expect(shim).toContain("updateContext:");
    expect(shim).toContain("fireEvent:");
  });

  it("forwards calls to the parent shell over postMessage", () => {
    const shim = generateBridgeShim({ namespaces: ["weather"] });
    expect(shim).toContain("window.parent.postMessage");
    expect(shim).toContain("'patchwork'");
  });

  it("creates a proxy for each service namespace", () => {
    const shim = generateBridgeShim({ namespaces: ["weather", "stripe"] });
    expect(shim).toContain('"weather"');
    expect(shim).toContain('"stripe"');
    expect(shim).toContain("new Proxy");
    expect(shim).toContain("kind: 'service'");
  });

  it("sends a fire event for fireEvent calls", () => {
    const shim = generateBridgeShim({ namespaces: [] });
    expect(shim).toContain("kind: 'fire'");
  });

  it("sends a subscribe message for subscribe calls", () => {
    const shim = generateBridgeShim({ namespaces: [] });
    expect(shim).toContain("kind: 'subscribe'");
  });

  it("sends a context message for updateContext calls", () => {
    const shim = generateBridgeShim({ namespaces: [] });
    expect(shim).toContain("kind: 'context'");
  });

  it("listens for host messages and resolves pending requests", () => {
    const shim = generateBridgeShim({ namespaces: ["weather"] });
    expect(shim).toContain("'patchwork-host'");
    expect(shim).toContain("stream-event");
    expect(shim).toContain("p.resolve");
    expect(shim).toContain("p.reject");
  });

  it("guards against double-injection", () => {
    const shim = generateBridgeShim({ namespaces: [] });
    expect(shim).toContain("if (window.patchwork) return");
  });

  it("is valid, evaluable JavaScript", () => {
    const shim = generateBridgeShim({ namespaces: ["weather"] });
    // Should parse without throwing.
    expect(() => new Function(shim)).not.toThrow();
  });
});
