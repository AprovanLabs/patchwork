/**
 * Image loader - fetches and loads image packages from CDN or local
 *
 * Images must be installed as npm packages or available on CDN.
 */

import type { LoadedImage } from '../types.js';
import { safeParseImageConfig, DEFAULT_IMAGE_CONFIG } from '../schemas.js';

const DEFAULT_CDN_BASE = 'https://esm.sh';

// Module-level CDN base URL (can be overridden)
let cdnBaseUrl = DEFAULT_CDN_BASE;

/**
 * Set the CDN base URL for image loading
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

export interface ImagePackageJson {
  name: string;
  version: string;
  main?: string;
  dependencies?: Record<string, string>;
  patchwork?: unknown;
}

/**
 * Parse image specifier into name and version
 */
export function parseImageSpec(spec: string): {
  name: string;
  version?: string;
} {
  // Handle scoped packages (@scope/name@version)
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
 * Fetch package.json from CDN
 */
export async function fetchPackageJson(
  packageName: string,
  version?: string,
): Promise<ImagePackageJson> {
  const versionSuffix = version ? `@${version}` : '';
  const url = `${cdnBaseUrl}/${packageName}${versionSuffix}/package.json`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch package.json for ${packageName}: ${response.statusText}`,
    );
  }

  return response.json() as Promise<ImagePackageJson>;
}

/**
 * Try to load an image package from local node_modules
 *
 * Uses dynamic require.resolve to find the package.json,
 * then loads the setup function from the main entry.
 */
async function loadLocalImage(name: string): Promise<LoadedImage | null> {
  // Only works in Node.js environment
  if (
    typeof globalThis.require === 'undefined' &&
    typeof process === 'undefined'
  ) {
    return null;
  }

  try {
    // Use createRequire to get require.resolve in ESM context
    const { createRequire } = await import('node:module');
    const { readFile } = await import('node:fs/promises');
    const { dirname, join } = await import('node:path');

    // Create require from current file for resolution
    const require = createRequire(import.meta.url);

    // Resolve package.json path
    let packageJsonPath: string;
    try {
      packageJsonPath = require.resolve(`${name}/package.json`);
    } catch {
      // Package not installed locally
      return null;
    }

    // Read and parse package.json
    const packageJsonContent = await readFile(packageJsonPath, 'utf-8');
    const packageJson: ImagePackageJson = JSON.parse(packageJsonContent);

    // Validate and extract patchwork config
    const config =
      safeParseImageConfig(packageJson.patchwork) || DEFAULT_IMAGE_CONFIG;

    // Try to load setup and mount functions
    let setup: LoadedImage['setup'];
    let mount: LoadedImage['mount'];
    const packageDir = dirname(packageJsonPath);

    if (packageJson.main) {
      try {
        const mainPath = join(packageDir, packageJson.main);
        const imageModule = await import(
          /* webpackIgnore: true */ /* @vite-ignore */ mainPath
        );
        if (typeof imageModule.setup === 'function') {
          setup = imageModule.setup;
        }
        if (typeof imageModule.mount === 'function') {
          mount = imageModule.mount;
        }
      } catch {
        // Setup/mount are optional
      }
    }

    return {
      name: packageJson.name,
      version: packageJson.version,
      config,
      dependencies: packageJson.dependencies || {},
      setup,
      mount,
    };
  } catch {
    // Fall back to other methods
    return null;
  }
}

/**
 * Load an image package
 *
 * Priority:
 * 1. Try to resolve locally (require.resolve for installed packages)
 * 2. Fetch from CDN
 *
 * Images must be explicitly installed or available on CDN.
 */
export async function loadImage(spec: string): Promise<LoadedImage> {
  const { name, version } = parseImageSpec(spec);

  // Try local resolution first (for installed packages)
  const localImage = await loadLocalImage(name);
  if (localImage) {
    return localImage;
  }

  // Fetch from CDN
  const packageJson = await fetchPackageJson(name, version);

  // Validate and extract patchwork config
  const config =
    safeParseImageConfig(packageJson.patchwork) || DEFAULT_IMAGE_CONFIG;

  // Try to load setup/mount functions if main is specified
  let setup: LoadedImage['setup'];
  let mount: LoadedImage['mount'];
  let moduleUrl: string | undefined;
  if (packageJson.main && typeof window !== 'undefined') {
    try {
      const versionSuffix = version ? `@${version}` : '';
      // Import with explicit main entry path so relative imports resolve correctly
      // Without this, the browser treats the package name as a file and resolves
      // relative imports to the wrong directory
      const mainEntry = packageJson.main.startsWith('./')
        ? packageJson.main.slice(2)
        : packageJson.main;
      const importUrl = `${cdnBaseUrl}/${name}${versionSuffix}/${mainEntry}`;
      moduleUrl = importUrl;
      const imageModule = await import(
        /* @vite-ignore */
        importUrl
      );
      if (typeof imageModule.setup === 'function') {
        setup = imageModule.setup;
      }
      if (typeof imageModule.mount === 'function') {
        mount = imageModule.mount;
      }
    } catch (err) {
      // Setup/mount are optional, but log the error for debugging
      console.error('[patchwork-compiler] Failed to load image module:', err);
    }
  }

  return {
    name: packageJson.name,
    version: packageJson.version,
    moduleUrl,
    config,
    dependencies: packageJson.dependencies || {},
    setup,
    mount,
  };
}
