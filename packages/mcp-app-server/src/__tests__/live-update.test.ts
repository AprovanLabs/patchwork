import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  appendEvent,
  getEvents,
  pushStreamUpdate,
  currentSeq,
  registerSession,
  unregisterSession,
  subscribeSession,
  unsubscribeSession,
  _resetForTests,
} from "../live-update.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Minimal McpServer stub — `server.notification()` is the SDK's one-way push method
function makeMockServer(notificationFn = vi.fn().mockResolvedValue(undefined)) {
  return {
    server: { notification: notificationFn },
  } as unknown as McpServer;
}

beforeEach(() => {
  _resetForTests();
});

describe("appendEvent / getEvents", () => {
  it("stores events and retrieves them by afterSeq", () => {
    appendEvent("prices", { price: 100 });
    appendEvent("prices", { price: 101 });
    const events = getEvents("prices", 0);
    expect(events).toHaveLength(2);
    expect(events[0]!.data).toEqual({ price: 100 });
    expect(events[1]!.data).toEqual({ price: 101 });
  });

  it("only returns events after the given seq", () => {
    appendEvent("prices", { price: 1 });
    const e2 = appendEvent("prices", { price: 2 });
    appendEvent("prices", { price: 3 });

    const events = getEvents("prices", e2.seq);
    expect(events).toHaveLength(1);
    expect(events[0]!.data).toEqual({ price: 3 });
  });

  it("returns empty array for unknown stream", () => {
    expect(getEvents("unknown", 0)).toEqual([]);
  });

  it("assigns monotonically increasing seq numbers across streams", () => {
    const a = appendEvent("a", 1);
    const b = appendEvent("b", 2);
    expect(b.seq).toBeGreaterThan(a.seq);
  });

  it("evicts oldest events when buffer exceeds 100 entries", () => {
    for (let i = 0; i < 110; i++) {
      appendEvent("big", i);
    }
    // We can still get events after seq 0, but only the last 100
    const events = getEvents("big", 0);
    expect(events.length).toBe(100);
  });
});

describe("currentSeq", () => {
  it("starts at 0 and increments on append", () => {
    expect(currentSeq()).toBe(0);
    appendEvent("s", 1);
    expect(currentSeq()).toBe(1);
    appendEvent("s", 2);
    expect(currentSeq()).toBe(2);
  });
});

describe("session registry", () => {
  it("registers and unregisters sessions", () => {
    const server = makeMockServer();
    registerSession("sess-1", server);
    // After registering, subscribing should work without error
    subscribeSession("sess-1", "prices");
    unregisterSession("sess-1");
    // After unregistering, subscribe is a no-op (doesn't throw)
    expect(() => subscribeSession("sess-1", "prices")).not.toThrow();
  });

  it("unsubscribeSession removes a stream", () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    const server = makeMockServer(notify);
    registerSession("sess-2", server);
    subscribeSession("sess-2", "prices");
    unsubscribeSession("sess-2", "prices");

    // pushStreamUpdate should not call notify since we unsubscribed
    return pushStreamUpdate("prices", { price: 99 }).then(() => {
      expect(notify).not.toHaveBeenCalled();
    });
  });
});

describe("pushStreamUpdate", () => {
  it("buffers the event and returns its seq", async () => {
    const seq = await pushStreamUpdate("orders", { id: 1 });
    expect(seq).toBeGreaterThan(0);
    const events = getEvents("orders", 0);
    expect(events).toHaveLength(1);
    expect(events[0]!.data).toEqual({ id: 1 });
  });

  it("sends notifications/tools/list_changed to subscribed sessions", async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    const server = makeMockServer(notify);
    registerSession("sess-a", server);
    subscribeSession("sess-a", "prices");

    await pushStreamUpdate("prices", { price: 42 });

    expect(notify).toHaveBeenCalledWith({
      method: "notifications/tools/list_changed",
    });
  });

  it("does not notify sessions subscribed to a different stream", async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    const server = makeMockServer(notify);
    registerSession("sess-b", server);
    subscribeSession("sess-b", "quotes"); // subscribed to "quotes", not "prices"

    await pushStreamUpdate("prices", { price: 42 });
    expect(notify).not.toHaveBeenCalled();
  });

  it("notifies multiple sessions subscribed to the same stream", async () => {
    const notify1 = vi.fn().mockResolvedValue(undefined);
    const notify2 = vi.fn().mockResolvedValue(undefined);
    registerSession("sess-c", makeMockServer(notify1));
    registerSession("sess-d", makeMockServer(notify2));
    subscribeSession("sess-c", "trades");
    subscribeSession("sess-d", "trades");

    await pushStreamUpdate("trades", { trade: "AAPL" });
    expect(notify1).toHaveBeenCalledOnce();
    expect(notify2).toHaveBeenCalledOnce();
  });

  it("continues notifying other sessions if one throws", async () => {
    const failing = vi.fn().mockRejectedValue(new Error("transport closed"));
    const ok = vi.fn().mockResolvedValue(undefined);
    registerSession("sess-fail", makeMockServer(failing));
    registerSession("sess-ok", makeMockServer(ok));
    subscribeSession("sess-fail", "events");
    subscribeSession("sess-ok", "events");

    // Should not reject even if one session fails
    await expect(pushStreamUpdate("events", { msg: "hi" })).resolves.toBeDefined();
    expect(ok).toHaveBeenCalledOnce();
  });
});
