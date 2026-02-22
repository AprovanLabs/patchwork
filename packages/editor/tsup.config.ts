import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: false,
  clean: true,
  external: [
    "react",
    "react-dom",
    "@aprovan/bobbin",
    "@aprovan/patchwork-compiler",
  ],
  treeshake: true,
});
