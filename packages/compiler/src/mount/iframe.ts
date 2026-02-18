/**
 * Iframe mount mode - mounts widgets in sandboxed iframes
 *
 * For untrusted widgets that need isolation.
 */

import type {
  CompiledWidget,
  LoadedImage,
  MountedWidget,
  MountOptions,
  ServiceProxy,
} from '../types.js';
import { ParentBridge, generateIframeBridgeScript } from './bridge.js';
import { generateImportMap } from '../transforms/cdn.js';

let mountCounter = 0;

// Shared bridge for all iframes
let sharedBridge: ParentBridge | null = null;

/**
 * Get or create the shared parent bridge
 */
function getParentBridge(proxy: ServiceProxy): ParentBridge {
  if (!sharedBridge) {
    sharedBridge = new ParentBridge(proxy);
  }
  return sharedBridge;
}

/**
 * Generate a unique mount ID
 */
function generateMountId(): string {
  return `pw-iframe-${Date.now()}-${++mountCounter}`;
}

/**
 * Default sandbox attributes for iframes (production)
 *
 * By default, iframes are strictly sandboxed without same-origin access.
 * This is the safest option when widgets load all dependencies from external CDNs.
 */
const DEFAULT_SANDBOX = ['allow-scripts'];

/**
 * Development sandbox attributes - includes allow-same-origin
 *
 * allow-same-origin is required when:
 * - Fetching modules from the parent origin (e.g., /_local-packages/ in dev)
 * - Using import maps that reference parent-relative URLs
 * - Accessing the parent's CDN proxy
 *
 * Note: This does NOT allow the iframe to access parent's DOM or cookies,
 * but it does allow same-origin network requests.
 *
 * WARNING: Combining allow-scripts + allow-same-origin allows the iframe to
 * escape its sandbox. Only use in development or when hosting on a separate subdomain.
 */
export const DEV_SANDBOX = ['allow-scripts', 'allow-same-origin'];

/**
 * Generate the HTML content for the iframe
 */
function generateIframeContent(
  image: LoadedImage | null,
  inputs: Record<string, unknown>,
  services: string[],
  baseUrl: string,
): string {
  const bridgeScript = generateIframeBridgeScript(services);

  // Generate import map from image dependencies and manifest packages
  const packages = {
    ...(image?.dependencies || {}),
  };
  const importMap = generateImportMap(packages);

  // CSS from image
  const css = image?.css || '';

  const frameworkConfig = image?.config?.framework || {};
  const preloadUrls = frameworkConfig.preload || [];
  const globals = frameworkConfig.globals || {};
  const globalNames = Object.values(globals);
  const imageModuleUrl = image?.moduleUrl || '';

  const mountScript = `
    // Run image setup inside the iframe (styling/runtime)
    const imageModuleUrl = ${JSON.stringify(imageModuleUrl)};

    // Preload framework modules declared by the image (if any)
    const preloadUrls = ${JSON.stringify(preloadUrls)};
    const globalNames = ${JSON.stringify(globalNames)};
    for (let i = 0; i < preloadUrls.length; i++) {
      const url = preloadUrls[i];
      const name = globalNames[i];
      if (!url || !name) continue;
      try {
        const mod = await import(/* webpackIgnore: true */ url);
        window[name] = mod;
      } catch (e) {
        console.error('[patchwork-iframe] Failed to preload:', url, e);
      }
    }

    const root = document.getElementById('root');
    const inputs = window.__PATCHWORK_INPUTS__ || {};

    if (imageModuleUrl && root) {
      try {
        const img = await import(/* webpackIgnore: true */ imageModuleUrl);
        if (typeof img?.setup === 'function') {
          await img.setup(root);
        }
      } catch (e) {
        console.error('[patchwork-iframe] Failed to run image setup:', e);
      }
    }

    function pickCreateElement(globals) {
      for (const obj of globals) {
        if (obj && typeof obj.createElement === 'function') return obj.createElement.bind(obj);
        if (obj?.default && typeof obj.default.createElement === 'function') return obj.default.createElement.bind(obj.default);
      }
      return null;
    }

    function pickRenderer(globals) {
      for (const obj of globals) {
        if (obj && typeof obj.createRoot === 'function') {
          return {
            kind: 'root',
            createRoot: obj.createRoot.bind(obj),
          };
        }
        if (obj && typeof obj.render === 'function') {
          return {
            kind: 'render',
            render: obj.render.bind(obj),
          };
        }
        if (obj?.default && typeof obj.default.createRoot === 'function') {
          return {
            kind: 'root',
            createRoot: obj.default.createRoot.bind(obj.default),
          };
        }
        if (obj?.default && typeof obj.default.render === 'function') {
          return {
            kind: 'render',
            render: obj.default.render.bind(obj.default),
          };
        }
      }
      return null;
    }

    function getGlobalsFromConfig() {
      const names = ${JSON.stringify(globalNames)};
      return names.map((n) => window[n]).filter(Boolean);
    }

    async function mountModule(mod) {
      if (!root) throw new Error('No #root element');

      if (typeof mod?.mount === 'function') {
        const cleanup = await mod.mount(root, inputs);
        if (typeof cleanup === 'function') window.__PATCHWORK_CLEANUP__ = cleanup;
        return;
      }

      if (typeof mod?.render === 'function') {
        const cleanup = await mod.render(root, inputs);
        if (typeof cleanup === 'function') window.__PATCHWORK_CLEANUP__ = cleanup;
        return;
      }

      const Component = mod?.default;
      if (typeof Component !== 'function') {
        root.textContent = 'Widget did not export a default component.';
        return;
      }

      const globals = getGlobalsFromConfig();
      const createElement = pickCreateElement(globals);
      const renderer = pickRenderer(globals);

      if (createElement && renderer?.kind === 'root') {
        const r = renderer.createRoot(root);
        r.render(createElement(Component, inputs));
        if (typeof r.unmount === 'function') window.__PATCHWORK_CLEANUP__ = () => r.unmount();
        return;
      }

      if (createElement && renderer?.kind === 'render') {
        renderer.render(createElement(Component, inputs), root);
        return;
      }

      const result = Component(inputs);
      if (result instanceof HTMLElement) {
        root.appendChild(result);
        return;
      }
      if (typeof result === 'string') {
        root.innerHTML = result;
        return;
      }

      root.textContent = 'No framework renderer available for this widget.';
    }

    // Wait for widget code via postMessage (more efficient than inline in srcdoc)
    // We convert relative URLs to absolute so they work inside blob URL context
    window.addEventListener('message', async function handleWidgetCode(event) {
      if (!event.data || event.data.type !== 'widget-code') return;
      window.removeEventListener('message', handleWidgetCode);
      
      const widgetCode = event.data.code;
      const origin = event.data.origin || ''; // Parent sends the origin
      
      // Convert relative URLs (starting with /) to absolute URLs
      // This is necessary because blob: URLs can't resolve relative imports
      // and srcdoc iframes have null origin
      const absoluteCode = widgetCode.replace(
        /from\\s*["'](\\/[^"']+)["']/g,
        (_, path) => 'from "' + origin + path + '"'
      ).replace(
        /import\\s*["'](\\/[^"']+)["']/g,
        (_, path) => 'import "' + origin + path + '"'
      );
      
      const blob = new Blob([absoluteCode], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      
      try {
        const mod = await import(/* webpackIgnore: true */ url);
        await mountModule(mod);
        window.parent.postMessage({ type: 'widget-mounted' }, '*');
      } catch (e) {
        console.error('[patchwork-iframe] Failed to mount widget:', e);
        window.parent.postMessage({ type: 'widget-error', error: e.message }, '*');
      } finally {
        URL.revokeObjectURL(url);
      }
    });

    // Signal ready to receive widget code
    window.parent.postMessage({ type: 'widget-ready' }, '*');

    // Set up ResizeObserver to report body size changes to parent
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        window.parent.postMessage({ 
          type: 'widget-resize', 
          width: Math.ceil(width), 
          height: Math.ceil(height) 
        }, '*');
      }
    });
    resizeObserver.observe(document.body);
  `;

  return `<!DOCTYPE html>
<html>
<head>
  <base href="${baseUrl}">
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; }
    ${css}
  </style>
  <script type="importmap">
    ${JSON.stringify({ imports: importMap }, null, 2)}
  </script>
</head>
<body>
  <div id="root"></div>

  <!-- Service Bridge -->
  <script>
    ${bridgeScript}
  </script>

  <!-- Widget Inputs -->
  <script>
    window.__PATCHWORK_INPUTS__ = ${JSON.stringify(inputs)};
  </script>

  <script type="module">
    ${mountScript}
  </script>
</body>
</html>`;
}

/**
 * Mount a widget in iframe mode (sandboxed)
 */
export async function mountIframe(
  widget: CompiledWidget,
  options: MountOptions,
  image: LoadedImage | null,
  proxy: ServiceProxy,
): Promise<MountedWidget> {
  const { target, sandbox = DEFAULT_SANDBOX, inputs = {} } = options;
  const mountId = generateMountId();

  // Create iframe
  const iframe = document.createElement('iframe');
  iframe.id = mountId;
  iframe.className = 'patchwork-widget patchwork-iframe';
  iframe.style.cssText = 'width: 100%; border: none; overflow: hidden;';
  iframe.sandbox.add(...sandbox);

  // Register with bridge before loading content
  const bridge = getParentBridge(proxy);
  bridge.registerIframe(iframe);

  // Generate and set iframe content (without widget code)
  // Use window.location.origin as base URL so relative paths like /_local-packages/ resolve correctly
  const services = widget.manifest.services || [];
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const content = generateIframeContent(image, inputs, services, baseUrl);
  iframe.srcdoc = content;

  // Append to target
  target.appendChild(iframe);

  // Handle resize messages from iframe
  const handleResize = (event: MessageEvent) => {
    if (event.source !== iframe.contentWindow) return;
    if (event.data?.type === 'widget-resize') {
      const { height } = event.data;
      if (typeof height === 'number' && height > 0) {
        iframe.style.height = `${height}px`;
      }
    }
  };
  window.addEventListener('message', handleResize);

  // Wait for iframe to signal ready, then send widget code
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Iframe mount timeout'));
    }, 30000);

    const handleMessage = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow) return;

      if (event.data?.type === 'widget-ready') {
        // Send widget code and origin for URL rewriting
        iframe.contentWindow?.postMessage(
          { type: 'widget-code', code: widget.code, origin: baseUrl },
          '*',
        );
      } else if (event.data?.type === 'widget-mounted') {
        cleanup();
        resolve();
      } else if (event.data?.type === 'widget-error') {
        cleanup();
        reject(new Error(event.data.error || 'Widget mount failed'));
      }
    };

    const cleanup = () => {
      clearTimeout(timeout);
      window.removeEventListener('message', handleMessage);
    };

    window.addEventListener('message', handleMessage);
  });

  // Create unmount function
  const unmount = () => {
    window.removeEventListener('message', handleResize);
    bridge.unregisterIframe(iframe);
    iframe.remove();
  };

  return {
    id: mountId,
    widget,
    mode: 'iframe',
    target,
    iframe,
    inputs,
    sandbox,
    unmount,
  };
}

/**
 * Hot reload an iframe widget
 */
export async function reloadIframe(
  mounted: MountedWidget,
  widget: CompiledWidget,
  image: LoadedImage | null,
  proxy: ServiceProxy,
): Promise<MountedWidget> {
  // Unmount existing
  mounted.unmount();

  // Remount with new widget
  return mountIframe(
    widget,
    {
      target: mounted.target,
      mode: 'iframe',
      sandbox: mounted.sandbox,
      inputs: mounted.inputs,
    },
    image,
    proxy,
  );
}

/**
 * Dispose the shared bridge (call on app shutdown)
 */
export function disposeIframeBridge(): void {
  if (sharedBridge) {
    sharedBridge.dispose();
    sharedBridge = null;
  }
}
