/**
 * CDN transform - converts bare imports to CDN URLs (esm.sh)
 */

import type { Plugin } from "esbuild-wasm";
import {
  setCdnBaseUrl,
  getCdnBaseUrl,
  toEsmShUrl,
  isBareImport,
  parsePackageSpec,
  parseImportPath,
  matchAlias,
  getCommonExports,
} from "../cdn-config.js";

// Re-export CDN utilities for external use
export {
  setCdnBaseUrl,
  getCdnBaseUrl,
  toEsmShUrl,
  isBareImport,
  parsePackageSpec,
  parseImportPath,
  matchAlias,
  getCommonExports,
};

// Packages that should be externalized (not bundled from CDN)
const EXTERNAL_PACKAGES = new Set(["react", "react-dom", "ink"]);

// Built-in Node.js modules that should remain external
const NODE_BUILTINS = new Set([
  "assert",
  "buffer",
  "child_process",
  "cluster",
  "crypto",
  "dgram",
  "dns",
  "events",
  "fs",
  "http",
  "http2",
  "https",
  "net",
  "os",
  "path",
  "perf_hooks",
  "process",
  "querystring",
  "readline",
  "stream",
  "string_decoder",
  "timers",
  "tls",
  "tty",
  "url",
  "util",
  "v8",
  "vm",
  "worker_threads",
  "zlib",
]);

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
    name: "cdn-transform",
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
              namespace: "global-inject",
            };
          }

          // Convert aliased import directly to CDN URL
          const version = packages[packageName];
          let url = toEsmShUrl(
            packageName,
            version,
            subpath,
            Object.keys(deps).length > 0 ? deps : undefined
          );
          if (bundle) {
            url += url.includes("?") ? "&bundle" : "?bundle";
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
            namespace: "global-inject",
          };
        }

        return null;
      });

      // Provide virtual modules that export window globals
      build.onLoad({ filter: /.*/, namespace: "global-inject" }, (args) => {
        const { packageName, subpath } = parseImportPath(args.path);
        const globalName = globals[packageName];

        if (!globalName) return null;

        // Handle subpath imports like 'react-dom/client'
        if (subpath) {
          // For react-dom/client, we need to access window.ReactDOM (which is already the client)
          return {
            contents: `export * from '${packageName}'; export { default } from '${packageName}';`,
            loader: "js",
          };
        }

        // Generate a module that exports the global
        // This handles both default and named exports
        const contents = `
const mod = window.${globalName};
export default mod;
// Re-export all properties as named exports
const { ${getCommonExports(packageName).join(", ")} } = mod;
export { ${getCommonExports(packageName).join(", ")} };
`;
        return {
          contents,
          loader: "js",
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
          Object.keys(deps).length > 0 ? deps : undefined
        );
        if (bundle) {
          url += url.includes("?") ? "&bundle" : "?bundle";
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
 * Generate import map for CDN dependencies
 */
export function generateImportMap(packages: Record<string, string>): Record<string, string> {
  const imports: Record<string, string> = {};

  for (const [name, version] of Object.entries(packages)) {
    imports[name] = toEsmShUrl(name, version);
  }

  return imports;
}
