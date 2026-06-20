import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * Builds the browser widget runtime (src/runtime) into dist/runtime.
 *
 * This is the shared runtime host page that fetches a widget's raw source and
 * compiles + mounts it in the browser via @aprovan/patchwork-compiler. It is
 * served statically by the widget server. No React plugin is needed here — the
 * host page is framework-agnostic; the widget's React is preloaded from the CDN
 * by the compiler at mount time.
 */
export default defineConfig({
  root: here("src/runtime"),
  base: "./",
  build: {
    outDir: here("dist/runtime"),
    emptyOutDir: true,
    // esm.sh modules don't ship the modulepreload polyfill target.
    modulePreload: false,
    rollupOptions: {
      input: here("src/runtime/index.html"),
    },
  },
  logLevel: "warn",
});
