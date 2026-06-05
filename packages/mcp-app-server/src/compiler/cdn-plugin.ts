import {
  type ImageConfig,
  toEsmShUrl,
  parseImportPath,
  isBareImport,
  matchAlias,
  getCommonExports,
} from "@aprovan/patchwork-compiler";
import type { Plugin } from "vite";

export interface CdnPluginOptions {
  imageConfig: ImageConfig;
  packages?: Record<string, string>;
}

export function patchworkCdnPlugin(options: CdnPluginOptions): Plugin {
  const { imageConfig } = options;
  const globals = imageConfig.framework?.globals ?? {};
  const deps = imageConfig.framework?.deps ?? {};
  const aliases = imageConfig.aliases ?? {};
  const packages = options.packages ?? {};
  const globalsSet = new Set(Object.keys(globals));

  return {
    name: "patchwork-cdn",
    enforce: "pre",

    resolveId(source) {
      if (!isBareImport(source)) return null;

      const aliasTarget = matchAlias(source, aliases);
      if (aliasTarget) {
        const { packageName, subpath } = parseImportPath(aliasTarget);

        if (globalsSet.has(packageName)) {
          return `${packageName}${subpath ? `/${subpath}` : ""}`;
        }

        const version = packages[packageName];
        const url = toEsmShUrl(
          packageName,
          version,
          subpath,
          Object.keys(deps).length > 0 ? deps : undefined
        );
        return { id: url, external: true };
      }

      const { packageName, subpath } = parseImportPath(source);

      if (globalsSet.has(packageName)) {
        return source;
      }

      const version = packages[packageName];
      const url = toEsmShUrl(
        packageName,
        version,
        subpath,
        Object.keys(deps).length > 0 ? deps : undefined
      );
      return { id: url, external: true };
    },

    load(id) {
      const { packageName, subpath } = parseImportPath(id);
      const globalName = globals[packageName];
      if (!globalName) return null;

      if (subpath) {
        const url = toEsmShUrl(
          packageName,
          packages[packageName],
          subpath,
          Object.keys(deps).length > 0 ? deps : undefined
        );
        return `export * from '${url}'; export { default } from '${url}';`;
      }

      const commonExports = getCommonExports(packageName);
      const lines = [`const mod = window.${globalName};`, `export default mod;`];

      if (commonExports.length > 0) {
        lines.push(
          `const { ${commonExports.join(", ")} } = mod;`,
          `export { ${commonExports.join(", ")} };`
        );
      }

      return lines.join("\n");
    },
  };
}

export function getPreloadScripts(imageConfig: ImageConfig): string[] {
  // Return raw URLs for dynamic import (not script tags)
  return imageConfig.framework?.preload ?? [];
}

export function getFrameworkGlobals(imageConfig: ImageConfig): Record<string, string> {
  return imageConfig.framework?.globals ?? {};
}
