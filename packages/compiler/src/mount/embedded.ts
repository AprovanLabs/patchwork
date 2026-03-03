/**
 * Embedded mount mode - mounts widgets directly in the DOM
 *
 * For trusted widgets that need full window access.
 */

import type {
  CompiledWidget,
  LoadedImage,
  MountedWidget,
  MountOptions,
  ServiceProxy,
} from '../types.js';
import {
  generateNamespaceGlobals,
  injectNamespaceGlobals,
  removeNamespaceGlobals,
  extractNamespaces,
} from './bridge.js';

let mountCounter = 0;
let importMapInjected = false;

/**
 * Inject an import map for bare module specifiers.
 * Maps package names to their CDN URLs so browsers can resolve them.
 * Must be called before any ES module imports happen.
 */
function injectImportMap(
  globals: Record<string, string>,
  preloadUrls: string[],
  deps?: Record<string, string>,
): void {
  // Only inject once per page (browser limitation)
  if (importMapInjected) return;

  // Check if there's already an import map
  const existingMap = document.querySelector('script[type="importmap"]');
  if (existingMap) {
    // Cannot modify existing import maps in standard browsers
    importMapInjected = true;
    return;
  }

  // Build import map from globals + preload URLs
  // Convention: globals keys are package names, preload URLs are in matching order
  const imports: Record<string, string> = {};
  const packageNames = Object.keys(globals);

  packageNames.forEach((pkgName, index) => {
    // Use the preload URL if available, otherwise construct CDN URL
    if (preloadUrls[index]) {
      imports[pkgName] = preloadUrls[index];
    } else if (deps?.[pkgName]) {
      imports[pkgName] = `https://esm.sh/${pkgName}@${deps[pkgName]}`;
    } else {
      imports[pkgName] = `https://esm.sh/${pkgName}`;
    }
  });

  // Also add common subpaths (e.g., react-dom/client)
  if (imports['react-dom']) {
    imports['react-dom/client'] = imports['react-dom'];
  }

  // Inject new import map
  const script = document.createElement('script');
  script.type = 'importmap';
  script.textContent = JSON.stringify({ imports }, null, 2);
  document.head.insertBefore(script, document.head.firstChild);

  importMapInjected = true;
}

/**
 * Generate a unique mount ID
 */
function generateMountId(): string {
  return `pw-mount-${Date.now()}-${++mountCounter}`;
}

type CreateElementFn = (...args: unknown[]) => unknown;
type CreateRootFn = (el: HTMLElement) => {
  render: (el: unknown) => void;
  unmount?: () => void;
};
type RenderFn = (el: unknown, container: HTMLElement) => void;

type Renderer =
  | { kind: 'root'; createRoot: CreateRootFn }
  | { kind: 'render'; render: RenderFn };

function pickCreateElement(
  globals: Array<Record<string, unknown>>,
): CreateElementFn | null {
  for (const obj of globals) {
    const ce = obj?.createElement;
    if (typeof ce === 'function') return ce as CreateElementFn;
    const def = obj?.default as Record<string, unknown> | undefined;
    if (def && typeof def.createElement === 'function') {
      return def.createElement as CreateElementFn;
    }
  }
  return null;
}

function pickRenderer(
  globals: Array<Record<string, unknown>>,
): Renderer | null {
  for (const obj of globals) {
    if (obj && typeof obj.createRoot === 'function') {
      return { kind: 'root', createRoot: obj.createRoot as CreateRootFn };
    }
    if (obj && typeof obj.render === 'function') {
      return { kind: 'render', render: obj.render as RenderFn };
    }
    const def = obj?.default as Record<string, unknown> | undefined;
    if (def && typeof def.createRoot === 'function') {
      return { kind: 'root', createRoot: def.createRoot as CreateRootFn };
    }
    if (def && typeof def.render === 'function') {
      return { kind: 'render', render: def.render as RenderFn };
    }
  }
  return null;
}

/**
 * Mount a widget in embedded mode (direct DOM injection)
 */
export async function mountEmbedded(
  widget: CompiledWidget,
  options: MountOptions,
  image: LoadedImage | null,
  proxy: ServiceProxy,
): Promise<MountedWidget> {
  const { target, inputs = {} } = options;
  const mountId = generateMountId();

  // Create container
  const container = document.createElement('div');
  container.id = mountId;
  container.className = 'patchwork-widget patchwork-embedded';
  target.appendChild(container);

  // Run image setup if available
  if (image?.setup) {
    await image.setup(container);
  }

  // Inject CSS if available
  if (image?.css) {
    const style = document.createElement('style');
    style.id = `${mountId}-style`;
    style.textContent = image.css;
    document.head.appendChild(style);
  }

  // Generate and inject service namespace globals
  const services = widget.manifest.services || [];
  const namespaceNames = extractNamespaces(services);
  const namespaces = generateNamespaceGlobals(services, proxy);
  injectNamespaceGlobals(window, namespaces);

  // Get framework config from image
  const frameworkConfig = image?.config?.framework || {};
  const preloadUrls = frameworkConfig.preload || [];
  const globalMapping = frameworkConfig.globals || {};
  const deps = frameworkConfig.deps || {};

  // Inject import map for bare module specifiers (must happen before ES module imports)
  // This allows the browser to resolve imports like 'react' to CDN URLs
  injectImportMap(globalMapping, preloadUrls, deps);

  // Pre-load framework modules from image config
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const preloadedModules: any[] = await Promise.all(
    preloadUrls.map(
      (url: string) => import(/* webpackIgnore: true */ /* @vite-ignore */ url),
    ),
  );

  // Set framework globals on window based on image config
  const win = window as unknown as Record<string, unknown>;
  const globalNames = Object.values(globalMapping) as string[];

  // Map preloaded modules to their global names
  // Convention: preload order matches globals order (react -> React, react-dom -> ReactDOM)
  preloadedModules.forEach((mod, index) => {
    if (globalNames[index]) {
      const name = globalNames[index];
      win[name] = mod;
    }
  });

  // Create a blob with the widget code
  const blob = new Blob([widget.code], { type: 'application/javascript' });
  const scriptUrl = URL.createObjectURL(blob);

  // Import the module
  let moduleCleanup: (() => void) | undefined;

  const globalObjects = globalNames
    .map((n) => win[n] as unknown)
    .filter(Boolean) as Array<Record<string, unknown>>;

  try {
    const module = await import(/* webpackIgnore: true */ scriptUrl);

    // Image-provided mount handler takes priority
    if (image?.mount) {
      const result = await image.mount(module, container, inputs);
      if (typeof result === 'function') {
        moduleCleanup = result;
      }
    } else if (typeof module.mount === 'function') {
      // Widget exports its own mount function
      const result = await module.mount(container, inputs);
      if (typeof result === 'function') {
        moduleCleanup = result;
      }
    } else if (typeof module.render === 'function') {
      // Custom render function
      const result = await module.render(container, inputs);
      if (typeof result === 'function') {
        moduleCleanup = result;
      }
    } else if (typeof module.default === 'function') {
      // Default export component - render using framework
      const Component = module.default;

      const createElement = pickCreateElement(globalObjects);
      const renderer = pickRenderer(globalObjects);

      if (createElement && renderer?.kind === 'root') {
        const root = renderer.createRoot(container);
        root.render(createElement(Component, inputs));
        if (typeof root.unmount === 'function') {
          moduleCleanup = () => root.unmount!();
        }
      } else if (createElement && renderer?.kind === 'render') {
        renderer.render(createElement(Component, inputs), container);
      } else {
        // No framework renderer - try calling as plain function
        const result = Component(inputs);
        if (result instanceof HTMLElement) {
          container.appendChild(result);
        } else if (typeof result === 'string') {
          container.innerHTML = result;
        }
      }
    }
  } finally {
    URL.revokeObjectURL(scriptUrl);
  }

  // Create unmount function
  const unmount = () => {
    // Call module cleanup if available
    if (moduleCleanup) {
      moduleCleanup();
    }

    // Remove namespace globals
    removeNamespaceGlobals(window, namespaceNames);

    // Remove style
    const style = document.getElementById(`${mountId}-style`);
    if (style) {
      style.remove();
    }

    // Remove container
    container.remove();
  };

  return {
    id: mountId,
    widget,
    mode: 'embedded',
    target,
    inputs,
    unmount,
  };
}

/**
 * Hot reload an embedded widget
 */
export async function reloadEmbedded(
  mounted: MountedWidget,
  widget: CompiledWidget,
  image: LoadedImage | null,
  proxy: ServiceProxy,
): Promise<MountedWidget> {
  // Unmount existing
  mounted.unmount();

  // Remount with new widget
  return mountEmbedded(
    widget,
    { target: mounted.target, mode: 'embedded', inputs: mounted.inputs },
    image,
    proxy,
  );
}
