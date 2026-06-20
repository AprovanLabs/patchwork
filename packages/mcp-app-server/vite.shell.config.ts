import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * Builds the MCP App "shell" (src/shell) into a single self-contained IIFE at
 * dist/shell/shell.js.
 *
 * The shell runs inside Claude's strict-CSP resource sandbox: it bundles the
 * ext-apps client (no wasm/eval) to perform the host handshake and bridge the
 * widget, and embeds the CSP-free runtime iframe that does the actual compile.
 * Served statically by the widget server at /shell.
 */
export default defineConfig({
  build: {
    outDir: here("dist/shell"),
    emptyOutDir: true,
    lib: {
      entry: here("src/shell/main.ts"),
      formats: ["iife"],
      name: "PatchworkShell",
      fileName: () => "shell.js",
    },
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
  logLevel: "warn",
});
