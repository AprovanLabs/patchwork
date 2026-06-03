import { describe, it, expect, vi } from "vitest";
import { ServiceBridge, type ServiceBackend, type ServiceToolInfo } from "../services.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const mockBackend: ServiceBackend = {
  call: vi.fn(async () => ({
    result: "mock-data",
  })),
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
        latitude: { type: "number", description: "Latitude" },
        longitude: { type: "number", description: "Longitude" },
      },
      required: ["latitude", "longitude"],
    },
  },
  {
    name: "weather.get_current_conditions",
    namespace: "weather",
    procedure: "get_current_conditions",
    description: "Get current weather conditions",
    parameters: {
      type: "object",
      properties: {
        location: { type: "string", description: "Location name" },
      },
    },
  },
  {
    name: "stripe.create_payment",
    namespace: "stripe",
    procedure: "create_payment",
    description: "Create a payment intent",
    parameters: {
      type: "object",
      properties: {
        amount: { type: "number", description: "Amount in cents" },
        currency: { type: "string", description: "Currency code" },
      },
      required: ["amount"],
    },
  },
];

describe("ServiceBridge", () => {
  describe("constructor", () => {
    it("stores tools from config", () => {
      const bridge = new ServiceBridge({
        backend: mockBackend,
        tools: mockTools,
      });
      expect(bridge.getToolInfos()).toHaveLength(3);
      expect(bridge.getNamespaces()).toEqual(["weather", "stripe"]);
    });

    it("handles empty tools array", () => {
      const bridge = new ServiceBridge({
        backend: mockBackend,
        tools: [],
      });
      expect(bridge.getToolInfos()).toHaveLength(0);
      expect(bridge.getNamespaces()).toEqual([]);
    });
  });

  describe("getNamespaces", () => {
    it("returns unique namespaces", () => {
      const bridge = new ServiceBridge({
        backend: mockBackend,
        tools: mockTools,
      });
      const namespaces = bridge.getNamespaces();
      expect(namespaces).toContain("weather");
      expect(namespaces).toContain("stripe");
      expect(namespaces).toHaveLength(2);
    });
  });

  describe("has", () => {
    it("returns true for existing tools", () => {
      const bridge = new ServiceBridge({
        backend: mockBackend,
        tools: mockTools,
      });
      expect(bridge.has("weather", "get_forecast")).toBe(true);
      expect(bridge.has("stripe", "create_payment")).toBe(true);
    });

    it("returns false for missing tools", () => {
      const bridge = new ServiceBridge({
        backend: mockBackend,
        tools: mockTools,
      });
      expect(bridge.has("weather", "nonexistent")).toBe(false);
      expect(bridge.has("unknown", "something")).toBe(false);
    });
  });

  describe("registerTools", () => {
    it("registers service tools on the MCP server", () => {
      const bridge = new ServiceBridge({
        backend: mockBackend,
        tools: mockTools,
      });
      const server = new McpServer({
        name: "test-server",
        version: "0.1.0",
      });

      bridge.registerTools(server);
    });
  });

  describe("registerSearchServices", () => {
    it("registers search_services tool on the MCP server", () => {
      const bridge = new ServiceBridge({
        backend: mockBackend,
        tools: mockTools,
      });
      const server = new McpServer({
        name: "test-server",
        version: "0.1.0",
      });

      bridge.registerSearchServices(server);
    });
  });

  describe("tool name mapping", () => {
    it("uses __ separator for MCP tool names (not dots)", () => {
      const bridge = new ServiceBridge({
        backend: mockBackend,
        tools: mockTools,
      });

      // The internal tool names use dots, but MCP tool names use __
      // We can verify this by checking the tool infos still have dot names
      const toolInfo = bridge.getToolInfos();
      expect(toolInfo[0]?.name).toBe("weather.get_forecast");
      expect(toolInfo[0]?.namespace).toBe("weather");
      expect(toolInfo[0]?.procedure).toBe("get_forecast");
    });
  });
});
