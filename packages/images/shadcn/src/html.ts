/**
 * @aprovan/patchwork-image-shadcnshadcn - HTML Generation
 *
 * Generates complete HTML documents for browser widget rendering.
 * The image owns the full HTML template including CSS, import maps, and mounting code.
 *
 * Uses Tailwind Play CDN for runtime CSS generation.
 */

import { DEFAULT_CSS_VARIABLES, DARK_CSS_VARIABLES } from './setup.js';

export interface HtmlOptions {
  /** Document title */
  title?: string;
  /** Theme: 'light' | 'dark' (default: 'dark') */
  theme?: 'light' | 'dark';
  /** Custom CSS to inject */
  customCss?: string;
  /** Widget props to pass */
  props?: Record<string, unknown>;
  /** Service namespaces to expose (generates bridge code) */
  services?: string[];
}

export interface ImportMapEntry {
  [pkg: string]: string;
}

/**
 * Generate CSS for the selected theme
 */
function generateThemeCss(theme: 'light' | 'dark'): string {
  const vars = theme === 'dark' ? DARK_CSS_VARIABLES : DEFAULT_CSS_VARIABLES;
  const cssVarsString = Object.entries(vars)
    .map(([key, value]) => `  ${key}: ${value};`)
    .join('\n');

  return `
:root {
${cssVarsString}
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
  line-height: 1.5;
  color: hsl(var(--foreground));
  background-color: hsl(var(--background));
}

*, *::before, *::after {
  border-color: hsl(var(--border));
}
`;
}

/**
 * Return the Tailwind Play CDN script URL.
 * Play CDN auto-initializes with MutationObserver, generating CSS on-demand.
 */
function getTailwindCdnScript(): string {
  return 'https://cdn.tailwindcss.com';
}

/**
 * Generate the mounting code for React widgets
 */
function generateMountCode(propsJson: string): string {
  return `
import { createRoot } from "react-dom/client";
import React from "react";

// Widget code will set window.__PATCHWORK_WIDGET__
const Component = window.__PATCHWORK_WIDGET__;
const props = ${propsJson};

if (Component) {
  const root = createRoot(document.getElementById('root'));
  root.render(React.createElement(Component, props));
  window.parent.postMessage({ type: 'patchwork:ready' }, '*');
} else {
  const root = createRoot(document.getElementById('root'));
  root.render(
    React.createElement('div', { style: { color: 'red', padding: '20px' } },
      React.createElement('h2', null, 'Error: No component found'),
      React.createElement('p', null, 'Widget must export a default component.')
    )
  );
  window.parent.postMessage({ type: 'patchwork:error', message: 'No component found' }, '*');
}

window.addEventListener('error', (e) => {
  window.parent.postMessage({ type: 'patchwork:error', message: e.message }, '*');
});
`;
}

/**
 * Transform compiled widget code to set global export
 */
export function transformWidgetCode(code: string): string {
  let result = code;

  // Handle: export { X as default }
  const namedMatch = result.match(/export\s*{\s*(\w+)\s+as\s+default\s*}/);
  if (namedMatch) {
    result = result.replace(
      /export\s*{\s*\w+\s+as\s+default\s*};?/,
      `window.__PATCHWORK_WIDGET__ = ${namedMatch[1]};`,
    );
  }

  // Handle: export default X or export default function X
  const directMatch = result.match(/export\s+default\s+(?:function\s+)?(\w+)/);
  if (directMatch && !namedMatch) {
    result = result.replace(
      /export\s+default\s+(?:function\s+)?(\w+)/,
      `window.__PATCHWORK_WIDGET__ = $1`,
    );
  }

  // Remove remaining exports
  return result.replace(/export\s*{[^}]*};?/g, '');
}

/**
 * Generate service bridge code for iframe communication
 *
 * Creates JavaScript that sets up:
 * 1. Message handling for service results from parent
 * 2. Dynamic proxy objects for each service namespace
 */
function generateServiceBridge(services: string[]): string {
  if (services.length === 0) return '';

  const namespaceAssignments = services
    .map((ns) => `window.${ns} = createNamespaceProxy('${ns}');`)
    .join('\n    ');

  return `
(function() {
  var pendingCalls = new Map();

  window.__patchwork_call__ = function(namespace, method, args) {
    return new Promise(function(resolve, reject) {
      var id = Math.random().toString(36).slice(2);
      pendingCalls.set(id, { resolve: resolve, reject: reject });
      window.parent.postMessage({
        type: 'patchwork:call',
        id: id,
        service: namespace,
        method: method,
        args: args
      }, '*');
      setTimeout(function() {
        if (pendingCalls.has(id)) {
          pendingCalls.delete(id);
          reject(new Error('Service call timeout: ' + namespace + '.' + method));
        }
      }, 30000);
    });
  };

  window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'patchwork:response') {
      var pending = pendingCalls.get(e.data.id);
      if (pending) {
        pendingCalls.delete(e.data.id);
        if (e.data.result.success) {
          pending.resolve(e.data.result.data);
        } else {
          pending.reject(new Error(e.data.result.error || 'Service call failed'));
        }
      }
    }
  });

  function createNamespaceProxy(namespace) {
    function createNestedProxy(path) {
      var fn = function() {
        return window.__patchwork_call__(namespace, path, Array.prototype.slice.call(arguments));
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

/**
 * Generate a complete HTML document for rendering a widget
 *
 * Uses Tailwind Play CDN which detects class usage via MutationObserver and
 * generates CSS on-demand.
 *
 * @param compiledJs - The compiled widget JavaScript code
 * @param importMap - Import map for dependencies
 * @param options - HTML generation options
 */
export function generateHtml(
  compiledJs: string,
  importMap: ImportMapEntry,
  options: HtmlOptions = {},
): string {
  const {
    title = 'Patchwork Widget',
    theme = 'dark',
    customCss = '',
    props = {},
    services = [],
  } = options;

  const themeCss = generateThemeCss(theme);
  const tailwindCdn = getTailwindCdnScript();
  const widgetCode = transformWidgetCode(compiledJs);
  const importMapJson = JSON.stringify({ imports: importMap }, null, 2);
  const propsJson = JSON.stringify(props);
  const mountCode = generateMountCode(propsJson);
  const serviceBridge = generateServiceBridge(services);

  return `<!DOCTYPE html>
<html lang="en" class="${theme}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <!-- Tailwind Play CDN - config must be set BEFORE script loads -->
  <script>
    window.tailwind = {
      config: ${JSON.stringify({
        darkMode: 'class',
        theme: {
          extend: {
            colors: {
              border: 'hsl(var(--border))',
              input: 'hsl(var(--input))',
              ring: 'hsl(var(--ring))',
              background: 'hsl(var(--background))',
              foreground: 'hsl(var(--foreground))',
              primary: {
                DEFAULT: 'hsl(var(--primary))',
                foreground: 'hsl(var(--primary-foreground))',
              },
              secondary: {
                DEFAULT: 'hsl(var(--secondary))',
                foreground: 'hsl(var(--secondary-foreground))',
              },
              destructive: {
                DEFAULT: 'hsl(var(--destructive))',
                foreground: 'hsl(var(--destructive-foreground))',
              },
              muted: {
                DEFAULT: 'hsl(var(--muted))',
                foreground: 'hsl(var(--muted-foreground))',
              },
              accent: {
                DEFAULT: 'hsl(var(--accent))',
                foreground: 'hsl(var(--accent-foreground))',
              },
              popover: {
                DEFAULT: 'hsl(var(--popover))',
                foreground: 'hsl(var(--popover-foreground))',
              },
              card: {
                DEFAULT: 'hsl(var(--card))',
                foreground: 'hsl(var(--card-foreground))',
              },
            },
            borderRadius: {
              lg: 'var(--radius)',
              md: 'calc(var(--radius) - 2px)',
              sm: 'calc(var(--radius) - 4px)',
            },
          },
        },
      })}
    };
  </script>
  <script src="${tailwindCdn}" crossorigin></script>
  <script type="importmap">${importMapJson}</script>
  <style>${themeCss}${customCss}</style>
</head>
<body>
  <div id="root"></div>
  <script>
    // Service bridge
    ${serviceBridge}
  </script>
  <script type="module">
    // Widget code
    ${widgetCode}
  </script>
  <script type="module">
    // Mount the widget
    ${mountCode}
  </script>
</body>
</html>`;
}

/**
 * Get the default import map for this image
 */
export function getDefaultImportMap(cdn = 'https://esm.sh'): ImportMapEntry {
  return {
    react: `${cdn}/react@18`,
    'react/': `${cdn}/react@18/`,
    'react-dom': `${cdn}/react-dom@18`,
    'react-dom/': `${cdn}/react-dom@18/`,
    'react-dom/client': `${cdn}/react-dom@18/client`,
  };
}

/**
 * Get framework dependencies declared by this image
 */
export function getFrameworkDependencies(): Record<string, string> {
  return {
    react: '^18.0.0',
    'react-dom': '^18.0.0',
  };
}
