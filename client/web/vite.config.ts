import path from "path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { localPackagesPlugin } from "./vite/local-packages-plugin.js";

export default defineConfig(async () => {
  await import("./scripts/load-env.js");

  const GATEWAY_URL = process.env.GATEWAY_URL ?? "http://localhost:4000";

  return {
    base: "/chat/",
    plugins: [
      tailwindcss(),
      react(),
      localPackagesPlugin({
        "@aprovan/patchwork-image-shadcn": "../../packages/images/shadcn",
      }),
    ],
    resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
    server: {
      proxy: {
        "/gateway": {
          target: GATEWAY_URL,
          changeOrigin: true,
          rewrite: (urlPath) => urlPath.replace(/^\/gateway/, ""),
        },
      },
    },
  };
});
