import fs from "node:fs/promises";
import path from "node:path";
import type { Plugin } from "vite";

const PREFIX = "/_local-packages/";

function mimeType(filePath: string): string {
  if (filePath.endsWith(".js") || filePath.endsWith(".mjs")) {
    return "application/javascript; charset=utf-8";
  }
  if (filePath.endsWith(".json")) {
    return "application/json; charset=utf-8";
  }
  return "text/plain; charset=utf-8";
}

async function tryRead(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

export function localPackagesPlugin(
  packages: Record<string, string>
): Plugin {
  const resolved: Record<string, string> = {};

  return {
    name: "local-packages",
    apply: "serve",
    configResolved(config) {
      for (const [name, localPath] of Object.entries(packages)) {
        resolved[name] = path.resolve(config.root, localPath);
      }
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          const rawUrl = (req.url ?? "").split("?")[0] ?? "";
          if (!rawUrl.startsWith(PREFIX)) return next();

          const after = rawUrl.slice(PREFIX.length);

          // Parse package name — scoped (@scope/name) or plain (name)
          let pkgName: string;
          let subpath: string;
          if (after.startsWith("@")) {
            const slash1 = after.indexOf("/", 1);
            if (slash1 === -1) return next();
            const slash2 = after.indexOf("/", slash1 + 1);
            if (slash2 === -1) {
              pkgName = after;
              subpath = "";
            } else {
              pkgName = after.slice(0, slash2);
              subpath = after.slice(slash2 + 1);
            }
          } else {
            const slash = after.indexOf("/");
            if (slash === -1) {
              pkgName = after;
              subpath = "";
            } else {
              pkgName = after.slice(0, slash);
              subpath = after.slice(slash + 1);
            }
          }

          const localPath = resolved[pkgName];
          if (!localPath) return next();

          let content: string | null = null;
          let servedPath = "";

          if (subpath === "" || subpath === "/") {
            // Root: resolve main entry from package.json
            const pkgText = await tryRead(path.join(localPath, "package.json"));
            if (!pkgText) {
              res.statusCode = 404;
              res.end();
              return;
            }
            const pkg = JSON.parse(pkgText) as { main?: string };
            const main = (pkg.main ?? "index.js").replace(/^\.\//, "");
            servedPath = path.join(localPath, main);
            content = await tryRead(servedPath);
          } else if (subpath === "package.json") {
            servedPath = path.join(localPath, "package.json");
            content = await tryRead(servedPath);
          } else {
            // Try dist/<subpath> first, then fall back to <subpath> directly
            const withDist = path.join(localPath, "dist", subpath);
            content = await tryRead(withDist);
            if (content !== null) {
              servedPath = withDist;
            } else {
              servedPath = path.join(localPath, subpath);
              content = await tryRead(servedPath);
            }
          }

          if (content === null) {
            res.statusCode = 404;
            res.end(`Not found: ${rawUrl}`);
            return;
          }

          res.setHeader("Content-Type", mimeType(servedPath));
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.statusCode = 200;
          res.end(content);
        } catch (err) {
          next(err);
        }
      });
    },
  };
}
