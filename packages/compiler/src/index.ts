/**
 * @aprovan/patchwork-compiler
 *
 * JSX→ESM compilation, image loading, and DOM mounting for Patchwork widgets.
 *
 * @example
 * ```typescript
 * import { createCompiler } from '@aprovan/patchwork-compiler';
 *
 * const compiler = await createCompiler({
 *   image: '@aprovan/patchwork-image-shadcn',
 *   proxyUrl: 'http://localhost:3000/api/proxy'
 * });
 *
 * const widget = await compiler.compile(source, manifest);
 * const mounted = await compiler.mount(widget, {
 *   target: document.getElementById('root'),
 *   mode: 'embedded'
 * });
 *
 * // Later...
 * compiler.unmount(mounted);
 * ```
 */

// Core compiler
export { createCompiler } from './compiler.js';

// Schemas (Zod validation)
export {
  // Schemas
  PlatformSchema,
  EsbuildConfigSchema,
  ImageConfigSchema,
  InputSpecSchema,
  ManifestSchema,
  CompileOptionsSchema,
  MountModeSchema,
  MountOptionsSchema,
  // Parsers
  parseImageConfig,
  safeParseImageConfig,
  parseManifest,
  safeParseManifest,
  // Defaults
  DEFAULT_IMAGE_CONFIG,
  DEFAULT_CLI_IMAGE_CONFIG,
} from './schemas.js';

// Types
export type {
  // Core types
  Platform,
  Manifest,
  InputSpec,
  CompileOptions,
  CompiledWidget,
  MountMode,
  MountOptions,
  MountedWidget,
  Compiler,
  CompilerOptions,
  // Image types
  ImageConfig,
  ImageMountFn,
  LoadedImage,
  // Service types
  ServiceProxy,
  ServiceCallHandler,
  GlobalInterfaceDefinition,
  BridgeMessage,
  BridgeMessageType,
  ServiceCallPayload,
  ServiceResultPayload,
} from './types.js';

// Images
export {
  // Registry
  ImageRegistry,
  getImageRegistry,
  createImageRegistry,
  // Loader
  loadImage,
  parseImageSpec,
  fetchPackageJson,
  setCdnBaseUrl,
  getCdnBaseUrl,
} from './images/index.js';

// Transforms
export {
  cdnTransformPlugin,
  generateImportMap,
  vfsPlugin,
} from './transforms/index.js';
export type {
  CdnTransformOptions,
  VFSPluginOptions,
} from './transforms/index.js';

// VFS
export {
  VFSStore,
  createProjectFromFiles,
  createSingleFileProject,
  resolveEntry,
  detectMainFile,
  IndexedDBBackend,
  LocalFSBackend,
  S3Backend,
} from './vfs/index.js';
export type {
  VirtualFile,
  VirtualProject,
  StorageBackend,
  LocalFSConfig,
  S3Config,
} from './vfs/index.js';

// Mount utilities
export {
  // Embedded
  mountEmbedded,
  reloadEmbedded,
  // Iframe
  mountIframe,
  reloadIframe,
  disposeIframeBridge,
  DEV_SANDBOX,
  // Bridge
  createHttpServiceProxy,
  createFieldAccessProxy,
  generateNamespaceGlobals,
  injectNamespaceGlobals,
  removeNamespaceGlobals,
  extractNamespaces,
  ParentBridge,
  createIframeServiceProxy,
  generateIframeBridgeScript,
} from './mount/index.js';
