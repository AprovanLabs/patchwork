import { randomUUID } from "node:crypto";
import { mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadImage,
  getImageRegistry,
  DEFAULT_IMAGE_CONFIG,
  type Manifest,
  type VirtualProject,
  type ImageConfig,
  type LoadedImage,
} from "@aprovan/patchwork-compiler";
import react from "@vitejs/plugin-react";
import { build, type InlineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { generateServiceShim, generateLiveUpdateShim } from "../shim.js";
import {
  computeCacheKey,
  set as cacheSet,
  has as cacheHas,
  get as cacheGet,
  type CachedWidget,
} from "./cache.js";
import { patchworkCdnPlugin, getPreloadScripts, getFrameworkGlobals } from "./cdn-plugin.js";

const WIDGET_RESOURCE_PREFIX = "ui://widget/";

const __dirname = dirname(fileURLToPath(import.meta.url));
const COMPILE_TMP_DIR = resolve(__dirname, "..", ".compile-tmp");

const FALLBACK_IMAGE_CONFIG: ImageConfig = {
  ...DEFAULT_IMAGE_CONFIG,
  framework: {
    globals: { react: "React", "react-dom": "ReactDOM" },
    preload: [
      "https://unpkg.com/react@18/umd/react.production.min.js",
      "https://unpkg.com/react-dom@18/umd/react-dom.production.min.js",
    ],
    deps: { react: "18", "react-dom": "18" },
  },
};

const IMAGE_SPEC = "@aprovan/patchwork-image-shadcn";

async function getImageConfig(): Promise<ImageConfig> {
  const registry = getImageRegistry();

  // Check if already loaded
  if (registry.has(IMAGE_SPEC)) {
    return registry.get(IMAGE_SPEC)!.config;
  }

  try {
    const image = await loadImage(IMAGE_SPEC);
    return image.config;
  } catch {
    return FALLBACK_IMAGE_CONFIG;
  }
}

function generateHtmlEntry(
  preloads: string[],
  globals: Record<string, string>,
  cssVars: string
): string {
  // Generate the preload script that dynamically imports modules and assigns to globals
  // This matches how the patchwork compiler's iframe mount handles it
  const preloadScript = `
    // Preload framework modules and assign to globals
    const preloadUrls = ${JSON.stringify(preloads)};
    const globalNames = ${JSON.stringify(Object.values(globals))};
    
    async function preloadModules() {
      for (let i = 0; i < preloadUrls.length; i++) {
        const url = preloadUrls[i];
        const name = globalNames[i];
        if (!url || !name) continue;
        try {
          const mod = await import(url);
          window[name] = mod.default || mod;
        } catch (e) {
          console.error('[patchwork] Failed to preload:', url, e);
        }
      }
    }
    
    // Export the preload promise so the widget module can await it
    window.__PATCHWORK_PRELOAD__ = preloadModules();
  `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    window.tailwind = window.tailwind || {};
    window.tailwind.config = {
      darkMode: "class",
      theme: {
        extend: {
          colors: {
            border: "hsl(var(--border))",
            input: "hsl(var(--input))",
            ring: "hsl(var(--ring))",
            background: "hsl(var(--background))",
            foreground: "hsl(var(--foreground))",
            primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
            secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--secondary-foreground))" },
            destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
            muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
            accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
            popover: { DEFAULT: "hsl(var(--popover))", foreground: "hsl(var(--popover-foreground))" },
            card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
          },
          borderRadius: { lg: "var(--radius)", md: "calc(var(--radius) - 2px)", sm: "calc(var(--radius) - 4px)" },
        },
      },
    };
  </script>
  <script type="module">${preloadScript}</script>
  <style>
    :root {
      ${cssVars}
    }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/_app.tsx"></script>
</body>
</html>`;
}

const SHADCN_CSS_VARS = `
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;
    --card: 0 0% 100%;
    --card-foreground: 222.2 84% 4.9%;
    --popover: 0 0% 100%;
    --popover-foreground: 222.2 84% 4.9%;
    --primary: 222.2 47.4% 11.2%;
    --primary-foreground: 210 40% 98%;
    --secondary: 210 40% 96.1%;
    --secondary-foreground: 222.2 47.4% 11.2%;
    --muted: 210 40% 96.1%;
    --muted-foreground: 215.4 16.3% 46.9%;
    --accent: 210 40% 96.1%;
    --accent-foreground: 222.2 47.4% 11.2%;
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 210 40% 98%;
    --border: 214.3 31.8% 91.4%;
    --input: 214.3 31.8% 91.4%;
    --ring: 222.2 84% 4.9%;
    --radius: 0.5rem;
`.trim();

function generateMainTsx(entryModule: string): string {
  return `import Widget from './${entryModule}';

(async () => {
  // Wait for framework preload to complete
  await window.__PATCHWORK_PRELOAD__;

  const React = window.React;
  const ReactDOM = window.ReactDOM;

  const rootEl = document.getElementById('root');
  if (rootEl && ReactDOM?.createRoot) {
    const root = ReactDOM.createRoot(rootEl);
    root.render(React.createElement(Widget));
  }
})();
`;
}

async function writeProjectFiles(
  projectDir: string,
  source: string | VirtualProject
): Promise<string> {
  const srcDir = join(projectDir, "src");
  await mkdir(srcDir, { recursive: true });

  if (typeof source === "string") {
    await writeFile(join(srcDir, "widget.tsx"), source, "utf-8");
    return "widget";
  }

  for (const [filePath, file] of source.files) {
    const fullPath = filePath.startsWith("src/")
      ? join(projectDir, filePath)
      : join(srcDir, filePath);
    const dir = resolve(fullPath, "..");
    await mkdir(dir, { recursive: true });
    await writeFile(fullPath, file.content, "utf-8");
  }

  const entry = source.entry;
  const entryName = entry.replace(/\.(tsx|ts|jsx|js)$/, "");
  return entryName.startsWith("src/") ? entryName.slice(4) : entryName;
}

function injectShimIntoHtml(html: string, shimScript: string): string {
  const shimTag = `<script type="module">\n${shimScript}\n</script>`;
  const bodyCloseIndex = html.lastIndexOf("</body>");
  if (bodyCloseIndex === -1) return html;
  return html.slice(0, bodyCloseIndex) + shimTag + "\n" + html.slice(bodyCloseIndex);
}

export interface CompileWidgetResult {
  html: string;
  hash: string;
  resourceUri: string;
}

export interface CompileWidgetOptions {
  services?: string[];
  /** Inject the live-update shim (window.patchwork) into the compiled widget. Defaults to true. */
  liveUpdates?: boolean;
}

export async function compileWidget(
  source: string | VirtualProject,
  manifest: Manifest,
  options: CompileWidgetOptions = {}
): Promise<CompileWidgetResult> {
  const liveUpdates = options.liveUpdates ?? true;

  const baseCacheKey = computeCacheKey(source, manifest);
  let cacheKey = baseCacheKey;
  if (options.services?.length) {
    cacheKey += `:svc:${options.services.sort().join(",")}`;
  }
  if (liveUpdates) {
    cacheKey += `:live`;
  }
  if (cacheHas(cacheKey)) {
    const cached = cacheGet(cacheKey)!;
    return {
      html: cached.html,
      hash: cacheKey,
      resourceUri: cached.resourceUri,
    };
  }

  const imageConfig = await getImageConfig();

  await mkdir(COMPILE_TMP_DIR, { recursive: true });
  const projectDir = join(COMPILE_TMP_DIR, `build-${randomUUID()}`);
  try {
    await mkdir(projectDir, { recursive: true });

    const entryModule = await writeProjectFiles(projectDir, source);
    await writeFile(join(projectDir, "src", "_app.tsx"), generateMainTsx(entryModule), "utf-8");

    const preloads = getPreloadScripts(imageConfig);
    const globals = getFrameworkGlobals(imageConfig);
    const htmlContent = generateHtmlEntry(preloads, globals, SHADCN_CSS_VARS);
    await writeFile(join(projectDir, "index.html"), htmlContent, "utf-8");

    const viteConfig: InlineConfig = {
      root: projectDir,
      base: "./",
      plugins: [
        patchworkCdnPlugin({ imageConfig }),
        react({
          jsxRuntime: "classic",
        }),
        viteSingleFile({ useRecommendedBuildConfig: true }),
      ],
      build: {
        outDir: "dist",
        emptyOutDir: true,
        minify: false,
        modulePreload: false, // Disable modulepreload polyfill - it doesn't exist on esm.sh
        rollupOptions: {
          input: resolve(projectDir, "index.html"),
        },
      },
      logLevel: "silent",
    };

    await build(viteConfig);

    const outputHtml = await readFile(join(projectDir, "dist", "index.html"), "utf-8");

    // Build up the shim scripts. The live-update shim is injected first so
    // __patchwork_app is available when the service shim runs. If both are
    // present the live-update shim guards against double-initialisation.
    const shimParts: string[] = [];
    if (liveUpdates) {
      shimParts.push(generateLiveUpdateShim());
    }
    if (options.services?.length) {
      shimParts.push(generateServiceShim({ namespaces: options.services }));
    }

    let finalHtml = outputHtml;
    for (const script of shimParts) {
      finalHtml = injectShimIntoHtml(finalHtml, script);
    }

    const resourceUri = `${WIDGET_RESOURCE_PREFIX}${cacheKey}/view.html`;

    const cacheEntry: CachedWidget = {
      html: finalHtml,
      manifest,
      resourceUri,
      createdAt: Date.now(),
    };
    cacheSet(cacheKey, cacheEntry);

    return { html: finalHtml, hash: cacheKey, resourceUri };
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
}

export { cacheGet, cacheHas, computeCacheKey };
