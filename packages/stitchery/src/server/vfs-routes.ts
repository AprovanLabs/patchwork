import {
  readFile,
  writeFile,
  unlink,
  readdir,
  stat,
  mkdir,
} from 'node:fs/promises';
import { join, relative, dirname } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

export interface VFSContext {
  rootDir: string;
  usePaths: boolean;
  log: (...args: unknown[]) => void;
}

async function listFilesRecursive(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await listFilesRecursive(full)));
      } else {
        files.push(full);
      }
    }
    return files;
  } catch {
    return [];
  }
}

async function ensureDir(filePath: string): Promise<void> {
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });
}

export function handleVFS(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: VFSContext,
): boolean {
  const url = req.url || '/';
  const method = req.method || 'GET';

  if (!url.startsWith('/vfs')) return false;

  // Handle config endpoint
  if (url === '/vfs/config' && method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(200);
    res.end(JSON.stringify({ usePaths: ctx.usePaths }));
    return true;
  }

  const handleRequest = async () => {
    const path = url.slice(4).split('?')[0] || '';
    const query = new URL(url, 'http://localhost').searchParams;

    if (path === '' || path === '/') {
      if (method === 'GET') {
        const prefix = query.get('prefix') || '';
        const files = await listFilesRecursive(join(ctx.rootDir, prefix));
        const relativePaths = files.map((f) => relative(ctx.rootDir, f));
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify(relativePaths));
        return;
      }
    }

    const filePath = join(ctx.rootDir, path.slice(1));

    switch (method) {
      case 'GET': {
        try {
          const content = await readFile(filePath, 'utf-8');
          res.setHeader('Content-Type', 'text/plain');
          res.writeHead(200);
          res.end(content);
        } catch {
          res.writeHead(404);
          res.end('Not found');
        }
        return;
      }
      case 'PUT': {
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', async () => {
          try {
            await ensureDir(filePath);
            await writeFile(filePath, body, 'utf-8');
            res.writeHead(200);
            res.end('ok');
          } catch (err) {
            ctx.log('VFS PUT error:', err);
            res.writeHead(500);
            res.end('Write failed');
          }
        });
        return;
      }
      case 'DELETE': {
        try {
          await unlink(filePath);
          res.writeHead(200);
          res.end('ok');
        } catch {
          res.writeHead(404);
          res.end('Not found');
        }
        return;
      }
      case 'HEAD': {
        try {
          await stat(filePath);
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
        res.end('Method not allowed');
    }
  };

  handleRequest().catch((err) => {
    ctx.log('VFS error:', err);
    res.writeHead(500);
    res.end('Internal error');
  });

  return true;
}
