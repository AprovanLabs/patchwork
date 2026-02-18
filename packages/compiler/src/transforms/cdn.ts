/**
 * CDN transform - converts bare imports to CDN URLs (esm.sh)
 */

import type { Plugin } from 'esbuild-wasm';

const DEFAULT_CDN_BASE = 'https://esm.sh';
let cdnBaseUrl = DEFAULT_CDN_BASE;

export function setCdnBaseUrl(url: string): void {
  cdnBaseUrl = url;
}

export function getCdnBaseUrl(): string {
  return cdnBaseUrl;
}

// Packages that should be externalized (not bundled from CDN)
const EXTERNAL_PACKAGES = new Set(['react', 'react-dom', 'ink']);

// Built-in Node.js modules that should remain external
const NODE_BUILTINS = new Set([
  'assert',
  'buffer',
  'child_process',
  'cluster',
  'crypto',
  'dgram',
  'dns',
  'events',
  'fs',
  'http',
  'http2',
  'https',
  'net',
  'os',
  'path',
  'perf_hooks',
  'process',
  'querystring',
  'readline',
  'stream',
  'string_decoder',
  'timers',
  'tls',
  'tty',
  'url',
  'util',
  'v8',
  'vm',
  'worker_threads',
  'zlib',
]);

/**
 * Parse a package specifier into name and version
 */
export function parsePackageSpec(spec: string): {
  name: string;
  version?: string;
} {
  // Handle scoped packages (@scope/name)
  if (spec.startsWith('@')) {
    const parts = spec.split('/');
    if (parts.length >= 2) {
      const scope = parts[0];
      const nameAndVersion = parts.slice(1).join('/');
      const atIndex = nameAndVersion.lastIndexOf('@');
      if (atIndex > 0) {
        return {
          name: `${scope}/${nameAndVersion.slice(0, atIndex)}`,
          version: nameAndVersion.slice(atIndex + 1),
        };
      }
      return { name: `${scope}/${nameAndVersion}` };
    }
  }

  // Handle non-scoped packages
  const atIndex = spec.lastIndexOf('@');
  if (atIndex > 0) {
    return {
      name: spec.slice(0, atIndex),
      version: spec.slice(atIndex + 1),
    };
  }
  return { name: spec };
}

/**
 * Convert a package specifier to an esm.sh URL
 *
 * @param packageName - The npm package name
 * @param version - Optional version specifier
 * @param subpath - Optional subpath (e.g., '/client' for 'react-dom/client')
 * @param deps - Optional dependency version overrides (use ?deps=react@18)
 */
export function toEsmShUrl(
  packageName: string,
  version?: string,
  subpath?: string,
  deps?: Record<string, string>,
): string {
  let url = `${cdnBaseUrl}/${packageName}`;

  if (version) {
    url += `@${version}`;
  }

  if (subpath) {
    url += `/${subpath}`;
  }

  // Add deps flag to ensure consistent dependency versions across all packages
  // This makes all packages use the same React version, avoiding version mismatches
  if (deps && Object.keys(deps).length > 0) {
    const depsStr = Object.entries(deps)
      .map(([name, ver]) => `${name}@${ver}`)
      .join(',');
    url += `?deps=${depsStr}`;
  }

  return url;
}

/**
 * Check if an import path is a bare module specifier
 */
export function isBareImport(path: string): boolean {
  // Not bare if starts with ., /, or is a URL
  if (
    path.startsWith('.') ||
    path.startsWith('/') ||
    path.startsWith('http://') ||
    path.startsWith('https://')
  ) {
    return false;
  }
  return true;
}

/**
 * Extract package name and subpath from an import
 */
export function parseImportPath(importPath: string): {
  packageName: string;
  subpath?: string;
} {
  // Handle scoped packages
  if (importPath.startsWith('@')) {
    const parts = importPath.split('/');
    if (parts.length >= 2) {
      const packageName = `${parts[0]}/${parts[1]}`;
      const subpath = parts.slice(2).join('/');
      return { packageName, subpath: subpath || undefined };
    }
  }

  // Handle non-scoped packages
  const parts = importPath.split('/');
  const packageName = parts[0] as string;
  const subpath = parts.slice(1).join('/');
  return { packageName, subpath: subpath || undefined };
}

export interface CdnTransformOptions {
  /** Map of package names to versions */
  packages?: Record<string, string>;
  /** Additional external packages */
  external?: string[];
  /** Use bundled versions from esm.sh (adds ?bundle) */
  bundle?: boolean;
  /** Packages to inject from window globals instead of CDN */
  globals?: Record<string, string>;
  /** Dependency version overrides for CDN URLs (e.g., { react: '18' }) */
  deps?: Record<string, string>;
  /** Import path aliases (e.g., { '@/components/ui/*': '@packagedcn/react' }) */
  aliases?: Record<string, string>;
}

/**
 * Match an import path against alias patterns
 * Supports glob patterns like '@/components/ui/*'
 */
function matchAlias(
  importPath: string,
  aliases: Record<string, string>,
): string | null {
  for (const [pattern, target] of Object.entries(aliases)) {
    // Handle glob patterns ending with /*
    if (pattern.endsWith('/*')) {
      const prefix = pattern.slice(0, -2); // Remove /*
      if (importPath === prefix || importPath.startsWith(prefix + '/')) {
        return target;
      }
    }
    // Exact match
    if (importPath === pattern) {
      return target;
    }
  }
  return null;
}

/**
 * Create an esbuild plugin that transforms bare imports to CDN URLs
 * and injects globals for specified packages (like React)
 */
export function cdnTransformPlugin(options: CdnTransformOptions = {}): Plugin {
  const {
    packages = {},
    external = [],
    bundle = false,
    globals = {},
    deps = {},
    aliases = {},
  } = options;

  const externalSet = new Set([...EXTERNAL_PACKAGES, ...external]);
  const globalsSet = new Set(Object.keys(globals));

  return {
    name: 'cdn-transform',
    setup(build) {
      // Handle import aliases first (e.g., @/components/ui/* -> @packagedcn/react)
      // This must resolve directly to CDN URL or global-inject
      build.onResolve({ filter: /.*/ }, (args) => {
        const aliasTarget = matchAlias(args.path, aliases);
        if (aliasTarget) {
          const { packageName, subpath } = parseImportPath(aliasTarget);

          // Check if aliased target should use globals
          if (globalsSet.has(packageName)) {
            return {
              path: aliasTarget,
              namespace: 'global-inject',
            };
          }

          // Convert aliased import directly to CDN URL
          const version = packages[packageName];
          let url = toEsmShUrl(
            packageName,
            version,
            subpath,
            Object.keys(deps).length > 0 ? deps : undefined,
          );
          if (bundle) {
            url += url.includes('?') ? '&bundle' : '?bundle';
          }

          return {
            path: url,
            external: true,
          };
        }
        return null;
      });

      // Handle packages that should come from window globals
      build.onResolve({ filter: /.*/ }, (args) => {
        if (!isBareImport(args.path)) {
          return null;
        }

        const { packageName } = parseImportPath(args.path);

        // Check if this package should be injected from globals
        if (globalsSet.has(packageName)) {
          return {
            path: args.path,
            namespace: 'global-inject',
          };
        }

        return null;
      });

      // Provide virtual modules that export window globals
      build.onLoad({ filter: /.*/, namespace: 'global-inject' }, (args) => {
        const { packageName, subpath } = parseImportPath(args.path);
        const globalName = globals[packageName];

        if (!globalName) return null;

        // Handle subpath imports like 'react-dom/client'
        if (subpath) {
          // For react-dom/client, we need to access window.ReactDOM (which is already the client)
          return {
            contents: `export * from '${packageName}'; export { default } from '${packageName}';`,
            loader: 'js',
          };
        }

        // Generate a module that exports the global
        // This handles both default and named exports
        const contents = `
const mod = window.${globalName};
export default mod;
// Re-export all properties as named exports
const { ${getCommonExports(packageName).join(', ')} } = mod;
export { ${getCommonExports(packageName).join(', ')} };
`;
        return {
          contents,
          loader: 'js',
        };
      });

      // Mark external packages and transform to CDN URLs
      build.onResolve({ filter: /.*/ }, (args) => {
        if (!isBareImport(args.path)) {
          return null; // Let esbuild handle relative/absolute imports
        }

        // Check if it's a Node.js builtin
        if (NODE_BUILTINS.has(args.path)) {
          return { external: true };
        }

        const { packageName, subpath } = parseImportPath(args.path);

        // Skip if handled by globals
        if (globalsSet.has(packageName)) {
          return null;
        }

        // Check if it should be external (but not converted to CDN)
        if (externalSet.has(packageName)) {
          return { external: true };
        }

        // Get version from packages map
        const version = packages[packageName];

        // Use deps from options for consistent dependency versions across CDN packages
        // This prevents multiple React instances which cause element serialization errors
        let url = toEsmShUrl(
          packageName,
          version,
          subpath,
          Object.keys(deps).length > 0 ? deps : undefined,
        );
        if (bundle) {
          url += url.includes('?') ? '&bundle' : '?bundle';
        }

        return {
          path: url,
          external: true,
        };
      });
    },
  };
}

/**
 * Get common named exports for known packages
 */
function getCommonExports(packageName: string): string[] {
  const exports: Record<string, string[]> = {
    react: [
      'useState',
      'useEffect',
      'useCallback',
      'useMemo',
      'useRef',
      'useContext',
      'useReducer',
      'useLayoutEffect',
      'useId',
      'createContext',
      'createElement',
      'cloneElement',
      'createRef',
      'forwardRef',
      'lazy',
      'memo',
      'Fragment',
      'Suspense',
      'StrictMode',
      'Component',
      'PureComponent',
      'Children',
      'isValidElement',
    ],
    'react-dom': [
      'createPortal',
      'flushSync',
      'render',
      'hydrate',
      'unmountComponentAtNode',
    ],
  };
  return exports[packageName] || [];
}

/**
 * Generate import map for CDN dependencies
 */
export function generateImportMap(
  packages: Record<string, string>,
): Record<string, string> {
  const imports: Record<string, string> = {};

  for (const [name, version] of Object.entries(packages)) {
    imports[name] = toEsmShUrl(name, version);
  }

  return imports;
}
