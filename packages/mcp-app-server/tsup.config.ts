import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/server.ts'],
  format: ['esm'],
  target: 'node20',
  clean: true,
  dts: true,
  splitting: false,
  sourcemap: true,
  shims: true,
  skipNodeModulesBundle: true,
  loader: { '.html': 'text' },
});
