import {
  readFile,
  writeFile,
  unlink,
  readdir,
  stat,
  mkdir,
  rm,
} from "node:fs/promises";
import { watch } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

export interface VFSContext {
  rootDir: string;
  usePaths: boolean;
  log: (...args: unknown[]) => void;
}

function normalizeRelPath(path: string): string {
  const decoded = decodeURIComponent(path).replace(/\\/g, "/");
  return decoded.replace(/^\/+|\/+$/g, "");
}

function resolvePath(rootDir: string, relPath: string): string {
  const root = resolve(rootDir);
  const full = resolve(root, relPath);
  if (full !== root && !full.startsWith(`${root}${sep}`)) {
    throw new Error("Invalid path");
  }
  return full;
}

function joinRelPath(base: string, name: string): string {
  return base ? `${base}/${name}` : name;
}

async function listAllFiles(
  rootDir: string,
  relPath: string,
): Promise<string[]> {
  const targetPath = resolvePath(rootDir, relPath);
  let entries: Awaited<ReturnType<typeof readdir>> = [];
  try {
    entries = await readdir(targetPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const results: string[] = [];
  for (const entry of entries) {
    const entryRelPath = joinRelPath(relPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await listAllFiles(rootDir, entryRelPath)));
    } else {
      results.push(entryRelPath);
    }
  }

  return results.sort((a, b) => a.localeCompare(b));
}

async function ensureDir(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.setHeader("Content-Type", "application/json");
  res.writeHead(status);
  res.end(JSON.stringify(body));
}

export function handleVFS(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: VFSContext,
): boolean {
  const url = req.url || "/";
  const method = req.method || "GET";

  if (!url.startsWith("/vfs")) return false;

  // Handle config endpoint
  if (url === "/vfs/config" && method === "GET") {
    res.setHeader("Content-Type", "application/json");
    res.writeHead(200);
    res.end(JSON.stringify({ usePaths: ctx.usePaths }));
    return true;
  }

  const handleRequest = async () => {
    const urlObj = new URL(url, "http://localhost");
    const query = urlObj.searchParams;
    const rawPath = urlObj.pathname.slice(4);
    const relPath = normalizeRelPath(rawPath);

    if (query.has("watch")) {
      if (method !== "GET") {
        res.writeHead(405);
        res.end("Method not allowed");
        return;
      }

      const watchPath = normalizeRelPath(query.get("watch") || "");
      const fullWatchPath = resolvePath(ctx.rootDir, watchPath);
      let watchStats;
      try {
        watchStats = await stat(fullWatchPath);
      } catch {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.writeHead(200);

      const watcher = watch(
        fullWatchPath,
        { recursive: watchStats.isDirectory() },
        async (eventType, filename) => {
          const eventPath = normalizeRelPath(
            [watchPath, filename ? filename.toString() : ""]
              .filter(Boolean)
              .join("/"),
          );
          const fullEventPath = resolvePath(ctx.rootDir, eventPath);

          let type: "create" | "update" | "delete" = "update";
          if (eventType === "rename") {
            try {
              await stat(fullEventPath);
              type = "create";
            } catch {
              type = "delete";
            }
          }

          res.write("event: change\n");
          res.write(
            `data: ${JSON.stringify({
              type,
              path: eventPath,
              mtime: new Date().toISOString(),
            })}\n\n`,
          );
        },
      );

      req.on("close", () => watcher.close());
      return;
    }

    if (method === "HEAD" && !relPath) {
      res.writeHead(200);
      res.end();
      return;
    }

    if (method === "GET" && !relPath && !query.toString()) {
      const files = await listAllFiles(ctx.rootDir, "");
      sendJson(res, 200, files);
      return;
    }

    if (!relPath && method !== "GET" && method !== "HEAD") {
      res.writeHead(400);
      res.end("Invalid path");
      return;
    }

    const targetPath = resolvePath(ctx.rootDir, relPath);

    if (method === "GET" && query.get("stat") === "true") {
      try {
        const stats = await stat(targetPath);
        sendJson(res, 200, {
          size: stats.size,
          mtime: stats.mtime.toISOString(),
          isFile: stats.isFile(),
          isDirectory: stats.isDirectory(),
        });
      } catch {
        res.writeHead(404);
        res.end("Not found");
      }
      return;
    }

    if (method === "GET" && query.get("readdir") === "true") {
      try {
        const entries = await readdir(targetPath, { withFileTypes: true });
        const mapped = entries
          .map((entry) => ({
            name: entry.name,
            isDirectory: entry.isDirectory(),
          }))
          .sort((a, b) => a.name.localeCompare(b.name));
        sendJson(res, 200, mapped);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOTDIR") {
          res.writeHead(409);
          res.end("Not a directory");
          return;
        }
        res.writeHead(404);
        res.end("Not found");
      }
      return;
    }

    if (method === "POST" && query.get("mkdir") === "true") {
      const recursive = query.get("recursive") === "true";
      try {
        await mkdir(targetPath, { recursive });
        res.writeHead(200);
        res.end("ok");
      } catch {
        res.writeHead(500);
        res.end("Mkdir failed");
      }
      return;
    }

    switch (method) {
      case "GET": {
        try {
          const content = await readFile(targetPath, "utf-8");
          res.setHeader("Content-Type", "text/plain");
          res.writeHead(200);
          res.end(content);
        } catch {
          res.writeHead(404);
          res.end("Not found");
        }
        return;
      }
      case "PUT": {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", async () => {
          try {
            await ensureDir(targetPath);
            await writeFile(targetPath, body, "utf-8");
            res.writeHead(200);
            res.end("ok");
          } catch (err) {
            ctx.log("VFS PUT error:", err);
            res.writeHead(500);
            res.end("Write failed");
          }
        });
        return;
      }
      case "DELETE": {
        const recursive = query.get("recursive") === "true";
        let stats;
        try {
          stats = await stat(targetPath);
        } catch {
          res.writeHead(404);
          res.end("Not found");
          return;
        }

        if (stats.isDirectory()) {
          if (!recursive) {
            try {
              const entries = await readdir(targetPath);
              if (entries.length > 0) {
                res.writeHead(409);
                res.end("Directory not empty");
                return;
              }
              await rm(targetPath, { recursive: false });
              res.writeHead(200);
              res.end("ok");
            } catch {
              res.writeHead(500);
              res.end("Delete failed");
            }
            return;
          }
          try {
            await rm(targetPath, { recursive: true });
            res.writeHead(200);
            res.end("ok");
          } catch {
            res.writeHead(500);
            res.end("Delete failed");
          }
          return;
        }

        try {
          await unlink(targetPath);
          res.writeHead(200);
          res.end("ok");
        } catch {
          res.writeHead(404);
          res.end("Not found");
        }
        return;
      }
      case "HEAD": {
        try {
          await stat(targetPath);
          res.writeHead(200);
          res.end();
        } catch {
          res.writeHead(404);
          res.end();
        }
        return;
      }
      default:
        res.writeHead(405);
        res.end("Method not allowed");
    }
  };

  handleRequest().catch((err) => {
    ctx.log("VFS error:", err);
    res.writeHead(500);
    res.end("Internal error");
  });

  return true;
}
