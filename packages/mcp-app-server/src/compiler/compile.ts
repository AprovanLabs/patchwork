import { mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { build, type InlineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import {
  createCompiler,
  loadImage,
  type Manifest,
  type VirtualProject,
  type ImageConfig,
  type LoadedImage,
} from "@aprovan/patchwork-compiler";
import { patchworkCdnPlugin, getPreloadScripts } from "./cdn-plugin.js";
import {
  computeCacheKey,
  set as cacheSet,
  has as cacheHas,
  get as cacheGet,
  type CachedWidget,
} from "./cache.js";

const WIDGET_RESOURCE_PREFIX = "ui://widget/";

const __dirname = dirname(fileURLToPath(import.meta.url));
const COMPILE_TMP_DIR = resolve(__dirname, "..", ".compile-tmp");

const FALLBACK_IMAGE_CONFIG: ImageConfig = {
  platform: "browser",
  esbuild: { target: "es2020", format: "esm", jsx: "automatic" },
  framework: {
    globals: { react: "React", "react-dom": "ReactDOM" },
    preload: [
      "https://esm.sh/react@18",
      "https://esm.sh/react-dom@18/client",
    ],
    deps: { react: "18", "react-dom": "18" },
  },
};

let loadedImage: LoadedImage | null = null;
let imageLoadPromise: Promise<LoadedImage> | null = null;

async function getImageConfig(): Promise<ImageConfig> {
  if (loadedImage) return loadedImage.config;
  if (imageLoadPromise) return imageLoadPromise.then((img) => img.config);

  imageLoadPromise = (async () => {
    try {
      loadedImage = await loadImage("@aprovan/patchwork-image-shadcn");
      return loadedImage;
    } catch {
      const compiler = await createCompiler({
        image: "@aprovan/patchwork-image-shadcn",
        proxyUrl: "",
      });
      await compiler.preloadImage("@aprovan/patchwork-image-shadcn");
      const registry = (compiler as unknown as Record<string, unknown>)
        .registry as Map<string, LoadedImage> | undefined;
      const img = registry?.get("@aprovan/patchwork-image-shadcn");
      if (img) {
        loadedImage = img;
        return img;
      }
      return { config: FALLBACK_IMAGE_CONFIG } as LoadedImage;
    }
  })();

  return imageLoadPromise.then((img) => img.config);
}

function generateHtmlEntry(preloads: string[], cssVars: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  ${preloads.join("\n  ")}
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
  return `import React from 'react';
import { createRoot } from 'react-dom/client';
import Widget from './${entryModule}';

const rootEl = document.getElementById('root');
if (rootEl) {
  const root = createRoot(rootEl);
  root.render(React.createElement(Widget));
}
`;
}

async function writeProjectFiles(
  projectDir: string,
  source: string | VirtualProject,
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
  return entryName.startsWith("src/")
    ? entryName.slice(4)
    : entryName;
}

export interface CompileWidgetResult {
  html: string;
  hash: string;
  resourceUri: string;
}

export async function compileWidget(
  source: string | VirtualProject,
  manifest: Manifest,
): Promise<CompileWidgetResult> {
  const cacheKey = computeCacheKey(source, manifest);
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
    await writeFile(
      join(projectDir, "src", "_app.tsx"),
      generateMainTsx(entryModule),
      "utf-8",
    );

    const preloads = getPreloadScripts(imageConfig);
    const htmlContent = generateHtmlEntry(preloads, SHADCN_CSS_VARS);
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
        rollupOptions: {
          input: resolve(projectDir, "index.html"),
        },
      },
      logLevel: "silent",
    };

    await build(viteConfig);

    const outputHtml = await readFile(
      join(projectDir, "dist", "index.html"),
      "utf-8",
    );

    const resourceUri = `${WIDGET_RESOURCE_PREFIX}${cacheKey}/view.html`;

    const cacheEntry: CachedWidget = {
      html: outputHtml,
      manifest,
      resourceUri,
      createdAt: Date.now(),
    };
    cacheSet(cacheKey, cacheEntry);

    return { html: outputHtml, hash: cacheKey, resourceUri };
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
}

export { cacheGet, cacheHas, computeCacheKey };
