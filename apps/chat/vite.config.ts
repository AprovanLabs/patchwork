import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const STITCHERY_URL = 'http://127.0.0.1:6434';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  server: {
    proxy: {
      '/api': {
        target: STITCHERY_URL,
        changeOrigin: true,
      },
      '/_local-packages': {
        target: STITCHERY_URL,
        changeOrigin: true,
      },
      '/vfs': {
        target: STITCHERY_URL,
        changeOrigin: true,
      },
    },
  },
});
