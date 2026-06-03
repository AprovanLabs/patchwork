import { describe, it, expect } from "vitest";
import { patchworkCdnPlugin, getPreloadScripts } from "../compiler/cdn-plugin.js";
import type { ImageConfig } from "@aprovan/patchwork-compiler";

const SHADCN_CONFIG: ImageConfig = {
  platform: "browser",
  esbuild: { target: "es2020", format: "esm", jsx: "transform" },
  framework: {
    globals: { react: "React", "react-dom": "ReactDOM" },
    preload: [
      "https://esm.sh/react@18",
      "https://esm.sh/react-dom@18/client",
    ],
    deps: { react: "18", "react-dom": "18" },
  },
  aliases: {
    "@/components/ui/*": "@packagedcn/react",
    "@/components/*": "@packagedcn/react",
    "@/lib/utils": "@packagedcn/react",
  },
};

describe("cdn-plugin", () => {
  describe("patchworkCdnPlugin", () => {
    it("creates a Vite plugin with correct name", () => {
      const plugin = patchworkCdnPlugin({ imageConfig: SHADCN_CONFIG });
      expect(plugin.name).toBe("patchwork-cdn");
    });

    it("has enforce: pre", () => {
      const plugin = patchworkCdnPlugin({ imageConfig: SHADCN_CONFIG });
      expect(plugin.enforce).toBe("pre");
    });

    it("has resolveId hook", () => {
      const plugin = patchworkCdnPlugin({ imageConfig: SHADCN_CONFIG });
      expect(plugin.resolveId).toBeTruthy();
    });

    it("has load hook", () => {
      const plugin = patchworkCdnPlugin({ imageConfig: SHADCN_CONFIG });
      expect(plugin.load).toBeTruthy();
    });

    it("works with empty image config", () => {
      const plugin = patchworkCdnPlugin({
        imageConfig: { platform: "browser" },
      });
      expect(plugin.name).toBe("patchwork-cdn");
    });

    it("works with custom packages option", () => {
      const plugin = patchworkCdnPlugin({
        imageConfig: SHADCN_CONFIG,
        packages: { "@packagedcn/react": "^1.0.0" },
      });
      expect(plugin.resolveId).toBeTruthy();
    });
  });

  describe("getPreloadScripts", () => {
    it("generates script tags from preload URLs", () => {
      const scripts = getPreloadScripts(SHADCN_CONFIG);
      expect(scripts).toHaveLength(2);
      expect(scripts[0]).toBe('<script src="https://esm.sh/react@18"></script>');
      expect(scripts[1]).toBe(
        '<script src="https://esm.sh/react-dom@18/client"></script>',
      );
    });

    it("returns empty array when no preloads", () => {
      const config: ImageConfig = {
        platform: "browser",
        framework: {},
      };
      const scripts = getPreloadScripts(config);
      expect(scripts).toHaveLength(0);
    });

    it("returns empty array when framework is undefined", () => {
      const config: ImageConfig = { platform: "browser" };
      const scripts = getPreloadScripts(config);
      expect(scripts).toHaveLength(0);
    });
  });
});
