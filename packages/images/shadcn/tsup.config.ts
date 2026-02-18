import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/setup.ts', 'src/html.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2020',
  external: ['react', 'react-dom'],
  // Bundle utility dependencies so browser can load module without import map
  noExternal: ['clsx', 'tailwind-merge', 'class-variance-authority'],
});
