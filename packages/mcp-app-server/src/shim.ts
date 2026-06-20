export interface BridgeShimOptions {
  /** Service namespaces the widget calls (e.g. ["weather", "stripe"]). */
  namespaces: string[];
}

/**
 * Generate the runtime-side bridge shim.
 *
 * This runs inside the CSP-free runtime iframe (the nested frame that compiles
 * and mounts the widget). It exposes `window.patchwork` and a proxy per service
 * namespace, but instead of talking to the MCP host directly — the runtime
 * iframe is one level removed from the host and can't — it forwards every call
 * to the parent shell over `postMessage`. The shell holds the ext-apps `App`
 * and relays to the host:
 *
 *   widget → window.patchwork.* / namespace.* → postMessage(parent) → shell → host
 *
 * Messages sent to the parent: `{ source: 'patchwork', kind, ... }`.
 * Messages received from the parent: `{ source: 'patchwork-host', kind, ... }`.
 */
export function generateBridgeShim(options: BridgeShimOptions): string {
  const namespacesJson = JSON.stringify(options.namespaces ?? []);

  return `
(function () {
  if (window.patchwork) return; // guard against double-injection

  var __pending = {};
  var __seq = 0;
  var __streams = {};

  function __post(msg) {
    msg.source = 'patchwork';
    window.parent.postMessage(msg, '*');
  }

  function __request(payload) {
    return new Promise(function (resolve, reject) {
      var id = 'r' + (++__seq);
      __pending[id] = { resolve: resolve, reject: reject };
      payload.id = id;
      __post(payload);
    });
  }

  window.addEventListener('message', function (e) {
    var m = e.data;
    if (!m || m.source !== 'patchwork-host') return;
    if (m.kind === 'result' && m.id && __pending[m.id]) {
      var p = __pending[m.id];
      delete __pending[m.id];
      if (m.ok) p.resolve(m.value);
      else p.reject(new Error(m.error || 'Service call failed'));
    } else if (m.kind === 'stream-event') {
      var cbs = __streams[m.stream];
      if (cbs) {
        for (var i = 0; i < cbs.length; i++) {
          try { cbs[i](m.data, m.seq, m.stream); }
          catch (err) { console.error('[patchwork] subscribe callback error:', err); }
        }
      }
    }
  });

  window.patchwork = {
    /** Subscribe to a named server data stream. Returns an unsubscribe fn. */
    subscribe: function (stream, cb) {
      if (!__streams[stream]) {
        __streams[stream] = [];
        __post({ kind: 'subscribe', stream: stream });
      }
      __streams[stream].push(cb);
      return function () {
        var a = __streams[stream];
        if (!a) return;
        var i = a.indexOf(cb);
        if (i !== -1) a.splice(i, 1);
      };
    },
    /** Push widget state into the conversation context. */
    updateContext: function (content) {
      __post({ kind: 'context', content: content });
      return Promise.resolve();
    },
    /** Fire a client event as an MCP tool call and await its result. */
    fireEvent: function (toolName, args) {
      return __request({ kind: 'fire', toolName: toolName, args: args || {} });
    }
  };

  var __namespaces = ${namespacesJson};
  for (var __i = 0; __i < __namespaces.length; __i++) {
    (function (ns) {
      window[ns] = new Proxy({}, {
        get: function (target, prop) {
          if (typeof prop !== 'string') return undefined;
          return function (args) {
            return __request({ kind: 'service', namespace: ns, procedure: prop, args: args || {} });
          };
        }
      });
    })(__namespaces[__i]);
  }
})();
`;
}
