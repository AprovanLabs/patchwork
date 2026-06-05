import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { warn } from "./logger.js";

/**
 * A single buffered event for a data stream.
 */
export interface StreamEvent {
  seq: number;
  data: unknown;
  timestamp: number;
}

const RING_BUFFER_MAX = 100;

/**
 * Process-level ring buffer for each named stream.
 * Shared across all sessions so any request can read from it.
 */
const streamBuffers = new Map<string, StreamEvent[]>();
let globalSeq = 0;

function getOrCreateBuffer(stream: string): StreamEvent[] {
  let buf = streamBuffers.get(stream);
  if (!buf) {
    buf = [];
    streamBuffers.set(stream, buf);
  }
  return buf;
}

/**
 * Retrieve buffered events for a stream with sequence numbers > afterSeq.
 */
export function getEvents(stream: string, afterSeq: number): StreamEvent[] {
  const buf = streamBuffers.get(stream);
  if (!buf) return [];
  return buf.filter((e) => e.seq > afterSeq);
}

/**
 * Write an event into the ring buffer for a stream.
 * Evicts the oldest entry when the buffer is full.
 */
export function appendEvent(stream: string, data: unknown): StreamEvent {
  const buf = getOrCreateBuffer(stream);
  const event: StreamEvent = {
    seq: ++globalSeq,
    data,
    timestamp: Date.now(),
  };
  buf.push(event);
  if (buf.length > RING_BUFFER_MAX) {
    buf.shift();
  }
  return event;
}

/**
 * Per-session subscription tracking.
 * A session is keyed by the MCP session ID; its McpServer is used to send
 * `notifications/tools/list_changed` as a push signal when stream events arrive.
 */
interface SessionEntry {
  server: McpServer;
  streams: Set<string>;
}

const sessions = new Map<string, SessionEntry>();

/**
 * Register a live MCP session so it can receive push notifications.
 */
export function registerSession(sessionId: string, server: McpServer): void {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, { server, streams: new Set() });
  }
}

/**
 * Unregister a session (e.g. on transport close or DELETE).
 */
export function unregisterSession(sessionId: string): void {
  sessions.delete(sessionId);
}

/**
 * Subscribe a session to a named stream.
 */
export function subscribeSession(sessionId: string, stream: string): void {
  const entry = sessions.get(sessionId);
  if (entry) {
    entry.streams.add(stream);
  }
}

/**
 * Unsubscribe a session from a named stream.
 */
export function unsubscribeSession(sessionId: string, stream: string): void {
  const entry = sessions.get(sessionId);
  if (entry) {
    entry.streams.delete(stream);
  }
}

/**
 * Push a data update to all sessions that have subscribed to `stream`.
 *
 * The event is appended to the ring buffer. Each subscribed session's McpServer
 * then sends a `notifications/tools/list_changed` notification to the host.
 * The host forwards this to the widget, which uses it as a signal to call
 * `poll_updates` and retrieve the buffered data.
 *
 * @returns The new sequence number assigned to this event.
 */
export async function pushStreamUpdate(
  stream: string,
  data: unknown,
): Promise<number> {
  const event = appendEvent(stream, data);

  const pushPromises: Promise<void>[] = [];
  for (const [, entry] of sessions) {
    if (entry.streams.has(stream)) {
      const notifyPromise = entry.server.server
        .notification({ method: "notifications/tools/list_changed" })
        .catch((err: unknown) => {
          warn("live-update", "Failed to notify session:", err);
        });
      pushPromises.push(notifyPromise);
    }
  }

  await Promise.all(pushPromises);
  return event.seq;
}

/**
 * Return the current highest sequence number (useful for initial subscribe).
 */
export function currentSeq(): number {
  return globalSeq;
}

/** Clears all buffers and sessions — for testing only. */
export function _resetForTests(): void {
  streamBuffers.clear();
  sessions.clear();
  globalSeq = 0;
}
