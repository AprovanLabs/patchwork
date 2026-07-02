import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    lambda: "src/lambda.ts",
  },
  format: ["esm"],
  target: "node20",
  platform: "node",
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  minify: false,
  shims: true,
});
