import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/extension.ts"],
  format: ["cjs"],
  target: "node20",
  dts: true,
  clean: true,
  sourcemap: true,
  external: ["vscode"],
});
