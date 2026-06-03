import type { Plugin } from "vite";
import type { ImageConfig } from "@aprovan/patchwork-compiler";

const ESM_SH_BASE = "https://esm.sh";

const REACT_EXPORTS = [
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
];

const REACT_DOM_EXPORTS = [
  "createPortal",
  "flushSync",
  "render",
  "hydrate",
  "unmountComponentAtNode",
];

function toEsmShUrl(
  packageName: string,
  version?: string,
  subpath?: string,
  deps?: Record<string, string>,
): string {
  let url: string = `${ESM_SH_BASE}/${packageName}`;
  if (version) url += `@${version}`;
  if (subpath) url += `/${subpath}`;
  if (deps && Object.keys(deps).length > 0) {
    const depsStr = Object.entries(deps)
      .map(([name, ver]) => `${name}@${ver}`)
      .join(",");
    url += `?deps=${depsStr}`;
  }
  return url;
}

function parseImportPath(importPath: string): {
  packageName: string;
  subpath?: string;
} {
  if (importPath.startsWith("@")) {
    const parts = importPath.split("/");
    if (parts.length >= 2) {
      const packageName = `${parts[0]}/${parts[1]}`;
      const subpath = parts.slice(2).join("/");
      return { packageName, subpath: subpath || undefined };
    }
  }
  const parts = importPath.split("/");
  return { packageName: parts[0] ?? "", subpath: parts.slice(1).join("/") || undefined };
}

function isBareImport(path: string): boolean {
  return !(
    path.startsWith(".") ||
    path.startsWith("/") ||
    path.startsWith("http://") ||
    path.startsWith("https://")
  );
}

function matchAlias(
  importPath: string,
  aliases: Record<string, string>,
): string | null {
  for (const [pattern, target] of Object.entries(aliases)) {
    if (pattern.endsWith("/*")) {
      const prefix = pattern.slice(0, -2);
      if (importPath === prefix || importPath.startsWith(prefix + "/")) {
        return target;
      }
    }
    if (importPath === pattern) {
      return target;
    }
  }
  return null;
}

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
          Object.keys(deps).length > 0 ? deps : undefined,
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
        Object.keys(deps).length > 0 ? deps : undefined,
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
          Object.keys(deps).length > 0 ? deps : undefined,
        );
        return `export * from '${url}'; export { default } from '${url}';`;
      }

      const commonExports =
        packageName === "react"
          ? REACT_EXPORTS
          : packageName === "react-dom"
            ? REACT_DOM_EXPORTS
            : [];

      const lines = [
        `const mod = window.${globalName};`,
        `export default mod;`,
      ];

      if (commonExports.length > 0) {
        lines.push(
          `const { ${commonExports.join(", ")} } = mod;`,
          `export { ${commonExports.join(", ")} };`,
        );
      }

      return lines.join("\n");
    },
  };
}

export function getPreloadScripts(imageConfig: ImageConfig): string[] {
  const preload = imageConfig.framework?.preload ?? [];
  return preload.map((url) => `<script src="${url}"></script>`);
}
