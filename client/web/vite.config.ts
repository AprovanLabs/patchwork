import path from "path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { localPackagesPlugin } from "./vite/local-packages-plugin.js";

const API_URL = process.env.API_URL ?? "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [
    react(),
    localPackagesPlugin({
      "@aprovan/patchwork-image-shadcn": "../../packages/images/shadcn",
    }),
  ],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  server: {
    proxy: {
      "/api": {
        target: API_URL,
        changeOrigin: true,
      },
    },
  },
});
