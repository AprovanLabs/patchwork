import path from "path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const API_URL = process.env.API_URL ?? "http://127.0.0.1:8000";
// GATEWAY_URL is read from the server environment at dev-server startup.
// In production the browser reads VITE_GATEWAY_URL directly (injected at build time).
const GATEWAY_URL = process.env.GATEWAY_URL ?? "";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  server: {
    proxy: {
      "/api": {
        target: API_URL,
        changeOrigin: true,
      },
      // In dev, proxy /gateway/* → the local gateway service.
      // This avoids CORS and lets the browser use relative paths.
      // In production, VITE_GATEWAY_URL is set and the browser calls the
      // gateway directly; this proxy entry is only active when GATEWAY_URL is set.
      ...(GATEWAY_URL
        ? {
            "/gateway": {
              target: GATEWAY_URL,
              changeOrigin: true,
              rewrite: (path) => path.replace(/^\/gateway/, ""),
            },
          }
        : {}),
    },
  },
});
