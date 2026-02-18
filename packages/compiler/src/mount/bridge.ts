/**
 * Service bridge - handles communication between widgets and service proxy
 */

import type {
  BridgeMessage,
  ServiceCallPayload,
  ServiceResultPayload,
  ServiceProxy,
} from '../types.js';

/**
 * Generate a unique message ID
 */
function generateMessageId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Create a service proxy that calls the backend via HTTP
 */
export function createHttpServiceProxy(proxyUrl: string): ServiceProxy {
  return {
    async call(
      namespace: string,
      procedure: string,
      args: unknown[],
    ): Promise<unknown> {
      const url = `${proxyUrl}/${namespace}/${procedure}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ args: args[0] ?? {} }),
      });

      if (!response.ok) {
        throw new Error(
          `Service call failed: ${response.status} ${response.statusText}`,
        );
      }

      const result = await response.json();
      return result;
    },
  };
}

/**
 * Creates a proxy that enables fluent method chaining for dynamic field access.
 *
 * This allows arbitrary nested property access that resolves to a callable function,
 * supporting patterns like `proxy.foo()`, `proxy.foo.bar()`, `proxy.bar.baz.qux()`.
 *
 * Used to create global namespace objects that proxy calls to a service backend.
 */
export function createFieldAccessProxy<T = unknown>(
  namespace: string,
  handler: (
    namespace: string,
    methodPath: string,
    ...args: T[]
  ) => Promise<unknown>,
): Record<string, (...args: T[]) => Promise<unknown>> {
  function createNestedProxy(path: string): (...args: T[]) => Promise<unknown> {
    const fn = (...args: T[]) => handler(namespace, path, ...args);

    return new Proxy(fn, {
      get(_, nestedName: string) {
        if (typeof nestedName === 'symbol') return undefined;
        const newPath = path ? `${path}.${nestedName}` : nestedName;
        return createNestedProxy(newPath);
      },
    }) as (...args: T[]) => Promise<unknown>;
  }

  return new Proxy(
    {},
    {
      get(_, fieldName: string) {
        if (typeof fieldName === 'symbol') return undefined;
        return createNestedProxy(fieldName);
      },
    },
  );
}

/**
 * Create namespace globals that proxy calls to a service proxy
 *
 * Creates dynamic proxy objects for each namespace that support arbitrary
 * nested method calls. This replaces the old static method registration.
 *
 * @param services - Array of service names (e.g., ['git', 'github'])
 * @param proxy - The service proxy to forward calls to
 * @returns Record of namespace names to proxy objects
 *
 * @example
 * ```typescript
 * const namespaces = generateNamespaceGlobals(['git', 'github'], proxy);
 * // namespaces.git.status() calls proxy.call('git', 'status', [])
 * // namespaces.github.repos.list_for_user({ username: 'x' })
 * //   calls proxy.call('github', 'repos.list_for_user', [{ username: 'x' }])
 * ```
 */
export function generateNamespaceGlobals(
  services: string[],
  proxy: ServiceProxy,
): Record<string, unknown> {
  const namespaces: Record<string, unknown> = {};
  const uniqueNamespaces = extractNamespaces(services);

  for (const namespace of uniqueNamespaces) {
    namespaces[namespace] = createFieldAccessProxy(
      namespace,
      (ns, method, ...args) => proxy.call(ns, method, args),
    );
  }

  return namespaces;
}

/**
 * Inject namespace globals into a window object
 */
export function injectNamespaceGlobals(
  target: Window | typeof globalThis,
  namespaces: Record<string, unknown>,
): void {
  for (const [name, value] of Object.entries(namespaces)) {
    (target as Record<string, unknown>)[name] = value;
  }
}

/**
 * Remove namespace globals from a window object
 */
export function removeNamespaceGlobals(
  target: Window | typeof globalThis,
  namespaceNames: string[],
): void {
  for (const name of namespaceNames) {
    delete (target as Record<string, unknown>)[name];
  }
}

/**
 * Extract unique namespace names from services array
 */
export function extractNamespaces(services: string[]): string[] {
  const namespaces = new Set<string>();
  for (const service of services) {
    const parts = service.split('.');
    if (parts[0]) {
      namespaces.add(parts[0]);
    }
  }
  return Array.from(namespaces);
}

/**
 * Parent-side bridge for iframe communication
 *
 * Listens for postMessage events from iframes and proxies service calls.
 */
export class ParentBridge {
  private proxy: ServiceProxy;
  private pendingCalls = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private iframes = new Set<HTMLIFrameElement>();
  private messageHandler: (event: MessageEvent) => void;

  constructor(proxy: ServiceProxy) {
    this.proxy = proxy;
    this.messageHandler = this.handleMessage.bind(this);
    if (typeof window !== 'undefined') {
      window.addEventListener('message', this.messageHandler);
    }
  }

  /**
   * Register an iframe to receive messages from
   */
  registerIframe(iframe: HTMLIFrameElement): void {
    this.iframes.add(iframe);
  }

  /**
   * Unregister an iframe
   */
  unregisterIframe(iframe: HTMLIFrameElement): void {
    this.iframes.delete(iframe);
  }

  /**
   * Handle incoming messages from iframes
   */
  private async handleMessage(event: MessageEvent): Promise<void> {
    // Verify source is a registered iframe
    const sourceIframe = Array.from(this.iframes).find(
      (iframe) => iframe.contentWindow === event.source,
    );

    if (!sourceIframe) {
      return; // Ignore messages from unknown sources
    }

    const message = event.data as BridgeMessage;
    if (!message || typeof message !== 'object') return;

    if (message.type === 'service-call') {
      const payload = message.payload as ServiceCallPayload;
      try {
        const result = await this.proxy.call(
          payload.namespace,
          payload.procedure,
          payload.args,
        );

        const response: BridgeMessage = {
          type: 'service-result',
          id: message.id,
          payload: { result } as ServiceResultPayload,
        };

        sourceIframe.contentWindow?.postMessage(response, '*');
      } catch (error) {
        const response: BridgeMessage = {
          type: 'service-result',
          id: message.id,
          payload: {
            error: error instanceof Error ? error.message : String(error),
          } as ServiceResultPayload,
        };

        sourceIframe.contentWindow?.postMessage(response, '*');
      }
    }
  }

  /**
   * Dispose the bridge
   */
  dispose(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('message', this.messageHandler);
    }
    this.iframes.clear();
    this.pendingCalls.clear();
  }
}

/**
 * Child-side bridge for iframe communication
 *
 * Creates a service proxy that sends postMessage to parent.
 */
export function createIframeServiceProxy(): ServiceProxy {
  const pendingCalls = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();

  // Listen for results from parent
  if (typeof window !== 'undefined') {
    window.addEventListener('message', (event: MessageEvent) => {
      const message = event.data as BridgeMessage;
      if (!message || typeof message !== 'object') return;

      if (message.type === 'service-result') {
        const pending = pendingCalls.get(message.id);
        if (pending) {
          pendingCalls.delete(message.id);
          const payload = message.payload as ServiceResultPayload;
          if (payload.error) {
            pending.reject(new Error(payload.error));
          } else {
            pending.resolve(payload.result);
          }
        }
      }
    });
  }

  return {
    call(
      namespace: string,
      procedure: string,
      args: unknown[],
    ): Promise<unknown> {
      return new Promise((resolve, reject) => {
        const id = generateMessageId();
        pendingCalls.set(id, { resolve, reject });

        const message: BridgeMessage = {
          type: 'service-call',
          id,
          payload: { namespace, procedure, args } as ServiceCallPayload,
        };

        window.parent.postMessage(message, '*');

        // Timeout after 30 seconds
        setTimeout(() => {
          if (pendingCalls.has(id)) {
            pendingCalls.delete(id);
            reject(
              new Error(`Service call timeout: ${namespace}.${procedure}`),
            );
          }
        }, 30000);
      });
    },
  };
}

/**
 * Generate the bridge script to inject into iframes
 *
 * Creates a self-contained script that sets up:
 * 1. Message handling for service results from parent
 * 2. Dynamic proxy objects for each namespace that support arbitrary nested calls
 */
export function generateIframeBridgeScript(services: string[]): string {
  const uniqueNamespaces = extractNamespaces(services);
  const namespaceAssignments = uniqueNamespaces
    .map((ns) => `window.${ns} = createNamespaceProxy('${ns}');`)
    .join('\n  ');

  return `
(function() {
  const pendingCalls = new Map();

  window.addEventListener('message', function(event) {
    const message = event.data;
    if (!message || typeof message !== 'object') return;

    if (message.type === 'service-result') {
      const pending = pendingCalls.get(message.id);
      if (pending) {
        pendingCalls.delete(message.id);
        if (message.payload.error) {
          pending.reject(new Error(message.payload.error));
        } else {
          pending.resolve(message.payload.result);
        }
      }
    }
  });

  function proxyCall(namespace, procedure, args) {
    return new Promise(function(resolve, reject) {
      const id = Date.now() + '-' + Math.random().toString(36).slice(2, 11);
      pendingCalls.set(id, { resolve: resolve, reject: reject });

      window.parent.postMessage({
        type: 'service-call',
        id: id,
        payload: { namespace: namespace, procedure: procedure, args: args }
      }, '*');

      setTimeout(function() {
        if (pendingCalls.has(id)) {
          pendingCalls.delete(id);
          reject(new Error('Service call timeout: ' + namespace + '.' + procedure));
        }
      }, 30000);
    });
  }

  // Create a dynamic proxy for a namespace that supports arbitrary nested method calls
  function createNamespaceProxy(namespace) {
    function createNestedProxy(path) {
      var fn = function() {
        return proxyCall(namespace, path, Array.prototype.slice.call(arguments));
      };

      return new Proxy(fn, {
        get: function(_, nestedName) {
          if (typeof nestedName === 'symbol') return undefined;
          var newPath = path ? path + '.' + nestedName : nestedName;
          return createNestedProxy(newPath);
        }
      });
    }

    return new Proxy({}, {
      get: function(_, fieldName) {
        if (typeof fieldName === 'symbol') return undefined;
        return createNestedProxy(fieldName);
      }
    });
  }

  ${namespaceAssignments}
})();
`;
}
