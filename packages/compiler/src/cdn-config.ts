/**
 * Shared CDN configuration for the patchwork compiler
 *
 * This module centralizes CDN base URL management used by:
 * - Image loading (images/loader.ts)
 * - CDN transforms (transforms/cdn.ts)
 * - Mount utilities (mount/embedded.ts)
 */

export const DEFAULT_CDN_BASE = "https://esm.sh";

// Module-level CDN base URL (can be overridden)
let cdnBaseUrl = DEFAULT_CDN_BASE;

/**
 * Set the CDN base URL for all CDN operations
 */
export function setCdnBaseUrl(url: string): void {
  cdnBaseUrl = url;
}

/**
 * Get the current CDN base URL
 */
export function getCdnBaseUrl(): string {
  return cdnBaseUrl;
}

/**
 * Convert a package specifier to a CDN URL
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
  deps?: Record<string, string>
): string {
  let url = `${cdnBaseUrl}/${packageName}`;

  if (version) {
    url += `@${version}`;
  }

  if (subpath) {
    url += `/${subpath}`;
  }

  // Add deps flag to ensure consistent dependency versions across all packages
  if (deps && Object.keys(deps).length > 0) {
    const depsStr = Object.entries(deps)
      .map(([name, ver]) => `${name}@${ver}`)
      .join(",");
    url += `?deps=${depsStr}`;
  }

  return url;
}

/**
 * Check if an import path is a bare module specifier
 */
export function isBareImport(path: string): boolean {
  return !(
    path.startsWith(".") ||
    path.startsWith("/") ||
    path.startsWith("http://") ||
    path.startsWith("https://")
  );
}

/**
 * Parse a package specifier into name and version
 */
export function parsePackageSpec(spec: string): {
  name: string;
  version?: string;
} {
  // Handle scoped packages (@scope/name)
  if (spec.startsWith("@")) {
    const parts = spec.split("/");
    if (parts.length >= 2) {
      const scope = parts[0];
      const nameAndVersion = parts.slice(1).join("/");
      const atIndex = nameAndVersion.lastIndexOf("@");
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
  const atIndex = spec.lastIndexOf("@");
  if (atIndex > 0) {
    return {
      name: spec.slice(0, atIndex),
      version: spec.slice(atIndex + 1),
    };
  }
  return { name: spec };
}

/**
 * Extract package name and subpath from an import
 */
export function parseImportPath(importPath: string): {
  packageName: string;
  subpath?: string;
} {
  // Handle scoped packages
  if (importPath.startsWith("@")) {
    const parts = importPath.split("/");
    if (parts.length >= 2) {
      const packageName = `${parts[0]}/${parts[1]}`;
      const subpath = parts.slice(2).join("/");
      return { packageName, subpath: subpath || undefined };
    }
  }

  // Handle non-scoped packages
  const parts = importPath.split("/");
  const packageName = parts[0] as string;
  const subpath = parts.slice(1).join("/");
  return { packageName, subpath: subpath || undefined };
}

/**
 * Match an import path against alias patterns
 * Supports glob patterns like '@/components/ui/*'
 */
export function matchAlias(importPath: string, aliases: Record<string, string>): string | null {
  for (const [pattern, target] of Object.entries(aliases)) {
    // Handle glob patterns ending with /*
    if (pattern.endsWith("/*")) {
      const prefix = pattern.slice(0, -2); // Remove /*
      if (importPath === prefix || importPath.startsWith(prefix + "/")) {
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
 * Common named exports for known packages (React, ReactDOM)
 * Used to generate virtual modules that re-export from window globals
 */
const COMMON_EXPORTS: Record<string, string[]> = {
  react: [
    "useState",
    "useEffect",
    "useCallback",
    "useMemo",
    "useRef",
    "useContext",
    "useReducer",
    "useLayoutEffect",
    "useId",
    "createContext",
    "createElement",
    "cloneElement",
    "createRef",
    "forwardRef",
    "lazy",
    "memo",
    "Fragment",
    "Suspense",
    "StrictMode",
    "Component",
    "PureComponent",
    "Children",
    "isValidElement",
  ],
  "react-dom": ["createPortal", "flushSync", "render", "hydrate", "unmountComponentAtNode"],
};

/**
 * Get common named exports for known packages
 */
export function getCommonExports(packageName: string): string[] {
  return COMMON_EXPORTS[packageName] ?? [];
}
