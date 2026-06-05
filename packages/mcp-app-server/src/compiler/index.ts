/**
 * Public API boundary for the compiler subsystem.
 *
 * This barrel module intentionally re-exports the compiler, CDN plugin, and
 * cache so that the rest of the package imports from a single entry point
 * (`./compiler/index.js`). Do not bypass it — add new exports here when
 * the public surface grows.
 */
export { compileWidget, cacheGet, cacheHas, type CompileWidgetResult, type CompileWidgetOptions } from "./compile.js";
export { getPreloadScripts, patchworkCdnPlugin, type CdnPluginOptions } from "./cdn-plugin.js";
export { computeCacheKey, get, set, has, clear, size, allEntries, type CachedWidget } from "./cache.js";
