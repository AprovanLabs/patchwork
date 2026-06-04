export interface ShimOptions {
  namespaces: string[];
  extAppsVersion?: string;
}

export interface LiveUpdateShimOptions {
  /** @default "^1.7.3" */
  extAppsVersion?: string;
}

const DEFAULT_EXT_APPS_VERSION = "^1.7.3";

/**
 * Generate the service-proxy shim that maps `namespace.procedure(args)` calls
 * to `app.callServerTool({ name: "namespace__procedure", arguments: args })`.
 *
 * Returns an empty string when `namespaces` is empty (nothing to proxy).
 */
export function generateServiceShim(options: ShimOptions): string {
  const {
    namespaces,
    extAppsVersion = DEFAULT_EXT_APPS_VERSION,
  } = options;

  if (namespaces.length === 0) return "";

  const namespacesJson = JSON.stringify(namespaces);
  const importUrl = `https://esm.sh/@modelcontextprotocol/ext-apps@${extAppsVersion}`;

  return `
import { App } from '${importUrl}';

const __patchwork_app = new App({ name: 'patchwork-widget', version: '0.1.0' });
const __patchwork_ready = __patchwork_app.connect().catch(function(err) {
  console.error('[patchwork] Failed to connect to host:', err);
});

function __patchwork_createNamespaceProxy(namespace) {
  return new Proxy({}, {
    get: function(target, prop) {
      if (typeof prop !== 'string') return undefined;
      return function __patchwork_serviceCall(args) {
        var toolName = namespace + '__' + prop;
        return __patchwork_ready.then(function() {
          return __patchwork_app.callServerTool({ name: toolName, arguments: args || {} });
        }).then(function(result) {
          if (result.isError) {
            var errorMsg = result.content && result.content[0] && result.content[0].text
              ? result.content[0].text
              : 'Service call failed: ' + namespace + '.' + prop;
            throw new Error(errorMsg);
          }
          var textContent = result.content && result.content.find(function(c) { return c.type === 'text'; });
          if (textContent) {
            try { return JSON.parse(textContent.text); }
            catch (e) { return textContent.text; }
          }
          return result;
        });
      };
    }
  });
}

var __patchwork_namespaces = ${namespacesJson};
for (var __i = 0; __i < __patchwork_namespaces.length; __i++) {
  var __ns = __patchwork_namespaces[__i];
  window[__ns] = __patchwork_createNamespaceProxy(__ns);
}
`;
}

/**
 * Generate the live-update shim that wires up `window.patchwork`:
 *
 * - `patchwork.subscribe(stream, callback)` — subscribe to a named data
 *   stream. Calls `subscribe_stream` on connect, then calls `callback(data)`
 *   each time new events arrive via `poll_updates`.
 * - `patchwork.updateContext(content)` — push widget state back to the model
 *   via `app.updateModelContext()`.
 * - `patchwork.fireEvent(toolName, args)` — convenience wrapper around
 *   `app.callServerTool()` for user interaction events.
 *
 * The shim uses a single shared `App` instance (exposed as
 * `window.__patchwork_app`) so it composes correctly with the service shim.
 * If the service shim is also injected it must use the same variable name —
 * both shims are concatenated in the compiler, and the first one to run
 * initialises the App; the second one skips the initialisation guard.
 */
export function generateLiveUpdateShim(
  options: LiveUpdateShimOptions = {},
): string {
  const { extAppsVersion = DEFAULT_EXT_APPS_VERSION } = options;
  const importUrl = `https://esm.sh/@modelcontextprotocol/ext-apps@${extAppsVersion}`;

  return `
import { App } from '${importUrl}';

// Shared App instance — the service shim may have already created this.
if (!window.__patchwork_app) {
  window.__patchwork_app = new App({ name: 'patchwork-widget', version: '0.1.0' });
  window.__patchwork_ready = window.__patchwork_app.connect().catch(function(err) {
    console.error('[patchwork] Failed to connect to host:', err);
  });
}

(function() {
  var __app = window.__patchwork_app;
  var __ready = window.__patchwork_ready;

  // Per-stream state: { seq, callbacks }
  var __streams = {};
  // MCP session ID captured after connect
  var __sessionId = null;

  function __parseResult(result) {
    if (!result || !result.content) return result;
    var textContent = result.content.find(function(c) { return c.type === 'text'; });
    if (textContent) {
      try { return JSON.parse(textContent.text); }
      catch (e) { return textContent.text; }
    }
    return result;
  }

  function __pollStream(stream) {
    var state = __streams[stream];
    if (!state) return;
    var afterSeq = state.seq;
    __app.callServerTool({ name: 'poll_updates', arguments: { stream: stream, after_seq: afterSeq } })
      .then(function(result) {
        var parsed = __parseResult(result);
        if (!parsed || !parsed.success || !parsed.events || !parsed.events.length) return;
        var events = parsed.events;
        for (var i = 0; i < events.length; i++) {
          var ev = events[i];
          if (ev.seq > state.seq) {
            state.seq = ev.seq;
          }
          for (var j = 0; j < state.callbacks.length; j++) {
            try { state.callbacks[j](ev.data, ev.seq, stream); }
            catch (cbErr) { console.error('[patchwork] subscribe callback error:', cbErr); }
          }
        }
      })
      .catch(function(err) {
        console.warn('[patchwork] poll_updates failed for stream ' + stream + ':', err);
      });
  }

  // When tools/list_changed fires, poll all subscribed streams.
  __app.setNotificationHandler(
    { method: 'notifications/tools/list_changed', params: {} },
    function() {
      var streamNames = Object.keys(__streams);
      for (var i = 0; i < streamNames.length; i++) {
        __pollStream(streamNames[i]);
      }
      return Promise.resolve();
    }
  );

  // Expose the public patchwork API on window.
  window.patchwork = {
    /**
     * Subscribe to a named data stream.
     *
     * @param {string} stream - Stream name (e.g. "price_feed").
     * @param {function} callback - Called with (data, seq, stream) for each event.
     * @returns {function} Unsubscribe function.
     */
    subscribe: function(stream, callback) {
      if (!__streams[stream]) {
        __streams[stream] = { seq: 0, callbacks: [] };
        // Tell the server about this subscription once the App is connected.
        __ready.then(function() {
          var args = { stream: stream };
          if (__sessionId) args.session_id = __sessionId;
          return __app.callServerTool({ name: 'subscribe_stream', arguments: args });
        }).then(function(result) {
          var parsed = __parseResult(result);
          if (parsed && typeof parsed.seq === 'number') {
            // Start polling from the server's current seq.
            if (__streams[stream]) {
              __streams[stream].seq = parsed.seq;
            }
          }
        }).catch(function(err) {
          console.warn('[patchwork] subscribe_stream failed:', err);
        });
      }
      __streams[stream].callbacks.push(callback);
      return function unsubscribe() {
        if (!__streams[stream]) return;
        var idx = __streams[stream].callbacks.indexOf(callback);
        if (idx !== -1) __streams[stream].callbacks.splice(idx, 1);
      };
    },

    /**
     * Push the widget's current state into the conversation context.
     * The model will include this in its next response.
     *
     * @param {string|Array} content - Text string or array of MCP ContentBlock objects.
     */
    updateContext: function(content) {
      return __ready.then(function() {
        var params;
        if (typeof content === 'string') {
          params = { content: [{ type: 'text', text: content }] };
        } else if (Array.isArray(content)) {
          params = { content: content };
        } else if (content && typeof content === 'object') {
          params = { structuredContent: content };
        } else {
          params = { content: [{ type: 'text', text: String(content) }] };
        }
        return __app.request({ method: 'ui/update-model-context', params: params }, {});
      });
    },

    /**
     * Fire a client event as an MCP tool call. Use this to surface user
     * interactions so the LLM can observe and react to them.
     *
     * @param {string} toolName - MCP tool name on the server.
     * @param {object} args - Tool arguments.
     */
    fireEvent: function(toolName, args) {
      return __ready.then(function() {
        return __app.callServerTool({ name: toolName, arguments: args || {} });
      }).then(function(result) {
        return __parseResult(result);
      });
    },
  };

  // Capture the session ID from the host context on connect.
  __ready.then(function() {
    // The host context is available via getHostContext(); we can't get the
    // session ID directly, but it's passed in subscribe_stream args from
    // user code. Expose a setter so widgets can supply it explicitly.
    window.patchwork._setSessionId = function(id) { __sessionId = id; };
  }).catch(function() {});
})();
`;
}
