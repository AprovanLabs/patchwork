import type { VirtualProject } from './vfs/types.js';

/**
 * Core types for the Patchwork compiler
 */

// Platform types
export type Platform = 'browser' | 'cli';

// Widget manifest
export interface Manifest {
  name: string;
  version: string;
  description?: string;
  platform: Platform;
  image: string;
  inputs?: Record<string, InputSpec>;
  services?: string[];
  packages?: Record<string, string>;
}

export interface InputSpec {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  default?: unknown;
  required?: boolean;
  description?: string;
}

// Compiler options (reserved for future use)
export interface CompileOptions {
  // Entry point and loader are inferred from VirtualProject.entry
}

// Compiled widget output
export interface CompiledWidget {
  /** Compiled ESM code */
  code: string;
  /** Content hash for caching */
  hash: string;
  /** Original manifest */
  manifest: Manifest;
  /** Source map (if generated) */
  sourceMap?: string;
}

// Mount options
export type MountMode = 'embedded' | 'iframe';

export interface MountOptions {
  /** Target DOM element to mount into */
  target: HTMLElement;
  /** Mount mode: embedded (trusted) or iframe (sandboxed) */
  mode: MountMode;
  /** CSP sandbox attributes for iframe mode */
  sandbox?: string[];
  /** Initial props/inputs to pass to widget */
  inputs?: Record<string, unknown>;
}

// Mounted widget handle
export interface MountedWidget {
  /** Unique mount ID */
  id: string;
  /** The compiled widget */
  widget: CompiledWidget;
  /** Mount mode used */
  mode: MountMode;
  /** Target element */
  target: HTMLElement;
  /** Iframe element (if mode is 'iframe') */
  iframe?: HTMLIFrameElement;
  /** Inputs used for the mount (if provided) */
  inputs?: Record<string, unknown>;
  /** Sandbox attributes used for iframe mode (if provided) */
  sandbox?: string[];
  /** Unmount function */
  unmount: () => void;
}

// Image package configuration (from package.json patchwork field)
export interface ImageConfig {
  platform: Platform;
  esbuild?: {
    target?: string;
    format?: 'esm' | 'cjs' | 'iife';
    jsx?: 'automatic' | 'transform' | 'preserve';
    jsxFactory?: string;
    jsxFragment?: string;
  };
  framework?: {
    /** Map of package names to window global names (e.g., { react: 'React' }) */
    globals?: Record<string, string>;
    /** CDN URLs to preload before widget execution */
    preload?: string[];
    /** Dependency version overrides for CDN packages (e.g., { react: '18' }) */
    deps?: Record<string, string>;
  };
  /** Import path aliases (e.g., { '@/components/ui/*': '@packagedcn/react' }) */
  aliases?: Record<string, string>;
}

/**
 * Mount function signature provided by images to handle widget mounting.
 * Takes the widget module exports and mounts it to the container.
 *
 * @param module - The widget module with its exports (default, mount, render, game, etc.)
 * @param container - The DOM element to mount into
 * @param inputs - Props/inputs to pass to the widget
 * @returns A cleanup function to unmount, or void
 */
export type ImageMountFn = (
  module: Record<string, unknown>,
  container: HTMLElement,
  inputs: Record<string, unknown>,
) => void | (() => void) | Promise<void | (() => void)>;

// Loaded image
export interface LoadedImage {
  /** Package name */
  name: string;
  /** Resolved version */
  version: string;
  /** Browser-importable module URL for this image (when loaded from CDN/local HTTP) */
  moduleUrl?: string;
  /** Package configuration */
  config: ImageConfig;
  /** Package dependencies */
  dependencies: Record<string, string>;
  /** Setup function (if available) */
  setup?: (root: HTMLElement) => void | Promise<void>;
  /** CSS content (if available) */
  css?: string;
  /**
   * Mount function to handle widget mounting.
   * Each image defines how it expects widgets to export their entry points.
   * Falls back to default mounting behavior if not provided.
   */
  mount?: ImageMountFn;
}

// Compiler factory options
export interface CompilerOptions {
  /** Image package to use (e.g., '@aprovan/patchwork-image-shadcnshadcn') */
  image: string;
  /** Backend proxy URL for service calls */
  proxyUrl: string;
  /** Base URL for CDN (default: 'https://esm.sh'). Used for loading image packages. */
  cdnBaseUrl?: string;
  /** Base URL for widget imports (default: same as cdnBaseUrl). Used for transforming imports in widget code. */
  widgetCdnBaseUrl?: string;
}

// Compiler interface
export interface Compiler {
  /** Pre-load an image package */
  preloadImage(spec: string): Promise<void>;

  /** Check if an image is loaded */
  isImageLoaded(spec: string): boolean;

  /** Compile widget source to ESM */
  compile(
    source: string | VirtualProject,
    manifest: Manifest,
    options?: CompileOptions,
  ): Promise<CompiledWidget>;

  /** Mount a compiled widget to the DOM */
  mount(widget: CompiledWidget, options: MountOptions): Promise<MountedWidget>;

  /** Unmount a mounted widget */
  unmount(mounted: MountedWidget): void;

  /** Hot reload a mounted widget */
  reload(
    mounted: MountedWidget,
    source: string | VirtualProject,
    manifest: Manifest,
  ): Promise<void>;
}

/**
 * Service proxy interface - abstracts service calls to backend
 *
 * The compiler provides the interface; actual implementation (e.g., UTCP, MCP)
 * is handled by the runtime/backend.
 */
export interface ServiceProxy {
  call(namespace: string, procedure: string, args: unknown[]): Promise<unknown>;
}

/**
 * Service call handler - function that handles calls for a specific namespace
 */
export type ServiceCallHandler = (
  procedure: string,
  args: unknown[],
) => Promise<unknown>;

/**
 * Global interface definition for code generation
 *
 * Describes available global namespaces and their methods that widgets can call.
 * Used during compilation to generate proper TypeScript declarations.
 */
export interface GlobalInterfaceDefinition {
  /** Namespace name (e.g., 'git', 'github') */
  name: string;
  /** Methods available on this namespace (supports nested paths like 'repos.list') */
  methods: string[];
  /** Optional TypeScript type definitions for methods */
  types?: string;
}

// Message types for iframe bridge
export type BridgeMessageType = 'service-call' | 'service-result' | 'error';

export interface BridgeMessage {
  type: BridgeMessageType;
  id: string;
  payload: unknown;
}

export interface ServiceCallPayload {
  namespace: string;
  procedure: string;
  args: unknown[];
}

export interface ServiceResultPayload {
  result?: unknown;
  error?: string;
}
