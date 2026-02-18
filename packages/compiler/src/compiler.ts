import * as esbuild from 'esbuild-wasm';
import type {
  Compiler,
  CompilerOptions,
  CompileOptions,
  CompiledWidget,
  Manifest,
  MountedWidget,
  MountOptions,
  ServiceProxy,
} from './types.js';
import type { VirtualProject } from './vfs/types.js';
import { createSingleFileProject } from './vfs/project.js';
import { getImageRegistry } from './images/registry.js';
import { setCdnBaseUrl as setImageCdnBaseUrl } from './images/loader.js';
import { setCdnBaseUrl as setTransformCdnBaseUrl } from './transforms/cdn.js';
import { cdnTransformPlugin } from './transforms/cdn.js';
import { vfsPlugin } from './transforms/vfs.js';
import { createHttpServiceProxy } from './mount/bridge.js';
import { mountEmbedded, reloadEmbedded } from './mount/embedded.js';
import { mountIframe, reloadIframe } from './mount/iframe.js';

// Track esbuild initialization
let esbuildInitialized = false;
let esbuildInitPromise: Promise<void> | null = null;

/**
 * Initialize esbuild-wasm (must be called before using esbuild)
 */
async function initEsbuild(): Promise<void> {
  if (esbuildInitialized) return;
  if (esbuildInitPromise) return esbuildInitPromise;

  esbuildInitPromise = (async () => {
    try {
      await esbuild.initialize({
        wasmURL: 'https://unpkg.com/esbuild-wasm/esbuild.wasm',
      });
      esbuildInitialized = true;
    } catch (error) {
      // If already initialized, that's fine
      if (error instanceof Error && error.message.includes('initialized')) {
        esbuildInitialized = true;
      } else {
        throw error;
      }
    }
  })();

  return esbuildInitPromise;
}

/**
 * Generate a content hash for caching
 */
function hashContent(content: string): string {
  // Use Web Crypto API for browser compatibility
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  // Simple hash for cache key (not cryptographic)
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    hash = ((hash << 5) - hash + (data[i] ?? 0)) | 0;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

/**
 * Create a compiler instance
 */
export async function createCompiler(
  options: CompilerOptions,
): Promise<Compiler> {
  // Initialize esbuild-wasm
  await initEsbuild();

  const { image: imageSpec, proxyUrl, cdnBaseUrl, widgetCdnBaseUrl } = options;

  // Set CDN base URLs (can be different for image loading vs widget imports)
  if (cdnBaseUrl) {
    setImageCdnBaseUrl(cdnBaseUrl);
  }
  // Widget imports use widgetCdnBaseUrl if provided, otherwise fall back to cdnBaseUrl or default
  if (widgetCdnBaseUrl) {
    setTransformCdnBaseUrl(widgetCdnBaseUrl);
  } else if (cdnBaseUrl) {
    setTransformCdnBaseUrl(cdnBaseUrl);
  }

  const registry = getImageRegistry();

  // Pre-load the initial image
  await registry.preload(imageSpec);

  // Create service proxy
  const proxy: ServiceProxy = createHttpServiceProxy(proxyUrl);

  return new PatchworkCompiler(proxy, registry);
}

/**
 * Patchwork compiler implementation
 */
class PatchworkCompiler implements Compiler {
  private proxy: ServiceProxy;
  private registry: ReturnType<typeof getImageRegistry>;

  constructor(
    proxy: ServiceProxy,
    registry: ReturnType<typeof getImageRegistry>,
  ) {
    this.proxy = proxy;
    this.registry = registry;
  }

  /**
   * Pre-load an image package
   */
  async preloadImage(spec: string): Promise<void> {
    await this.registry.preload(spec);
  }

  /**
   * Check if an image is loaded
   */
  isImageLoaded(spec: string): boolean {
    return this.registry.has(spec);
  }

  /**
   * Compile widget source to ESM
   */
  async compile(
    source: string | VirtualProject,
    manifest: Manifest,
    _options: CompileOptions = {},
  ): Promise<CompiledWidget> {
    // Normalize input to VirtualProject (entry defined by project, defaults to main.tsx)
    const project =
      typeof source === 'string' ? createSingleFileProject(source) : source;

    // Infer loader from entry file extension
    const entryExt = project.entry.split('.').pop();
    const loader = entryExt === 'ts' || entryExt === 'tsx' ? 'tsx' : 'jsx';

    // Get image from registry based on manifest
    const image = this.registry.get(manifest.image) || null;

    // Get config from image (with proper typing)
    const esbuildConfig = image?.config.esbuild || {};
    const frameworkConfig = image?.config.framework || {};

    const target = esbuildConfig.target || 'es2020';
    const format = esbuildConfig.format || 'esm';
    const jsx = esbuildConfig.jsx ?? 'automatic';

    // Collect all packages (image deps + manifest packages)
    const packages: Record<string, string> = {
      ...(image?.dependencies || {}),
      ...(manifest.packages || {}),
    };

    const globals = frameworkConfig.globals || {};

    // Get dependency version overrides from image config (e.g., { react: '18' })
    const deps = frameworkConfig.deps || {};

    // Get import path aliases from image config (e.g., { '@/components/ui/*': '@packagedcn/react' })
    const aliases = image?.config.aliases || {};

    // Get entry file content
    const entryFile = project.files.get(project.entry);
    if (!entryFile) {
      throw new Error(`Entry file not found: ${project.entry}`);
    }

    // Build with esbuild using image-provided configuration
    const result = await esbuild.build({
      stdin: {
        contents: entryFile.content,
        loader,
        sourcefile: project.entry,
      },
      bundle: true,
      format,
      target,
      platform: manifest.platform === 'cli' ? 'node' : 'browser',
      jsx,
      ...(esbuildConfig.jsxFactory
        ? { jsxFactory: esbuildConfig.jsxFactory }
        : {}),
      ...(esbuildConfig.jsxFragment
        ? { jsxFragment: esbuildConfig.jsxFragment }
        : {}),
      write: false,
      sourcemap: 'inline',
      plugins: [
        vfsPlugin(project, { aliases }),
        cdnTransformPlugin({
          packages,
          globals,
          deps,
          aliases,
        }),
      ],
    });

    const code = result.outputFiles?.[0]?.text || '';
    const hash = hashContent(code);

    return {
      code,
      hash,
      manifest,
    };
  }

  /**
   * Mount a compiled widget to the DOM
   */
  async mount(
    widget: CompiledWidget,
    options: MountOptions,
  ): Promise<MountedWidget> {
    const image = this.registry.get(widget.manifest.image) || null;
    if (options.mode === 'iframe') {
      return mountIframe(widget, options, image, this.proxy);
    }
    return mountEmbedded(widget, options, image, this.proxy);
  }

  /**
   * Unmount a mounted widget
   */
  unmount(mounted: MountedWidget): void {
    mounted.unmount();
  }

  /**
   * Hot reload a mounted widget
   */
  async reload(
    mounted: MountedWidget,
    source: string | VirtualProject,
    manifest: Manifest,
  ): Promise<void> {
    // Compile new version
    const widget = await this.compile(source, manifest);
    const image = this.registry.get(widget.manifest.image) || null;

    // Reload based on mode
    if (mounted.mode === 'iframe') {
      await reloadIframe(mounted, widget, image, this.proxy);
    } else {
      await reloadEmbedded(mounted, widget, image, this.proxy);
    }
  }
}
