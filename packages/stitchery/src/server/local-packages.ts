import type { IncomingMessage, ServerResponse } from 'node:http';
import fs from 'fs';
import path from 'path';

export interface LocalPackagesContext {
  localPackages: Record<string, string>;
  log: (...args: unknown[]) => void;
}

export function handleLocalPackages(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: LocalPackagesContext,
): boolean {
  const rawUrl = req.url || '';

  // Only handle /_local-packages routes
  if (!rawUrl.startsWith('/_local-packages')) {
    return false;
  }

  const urlWithoutPrefix = rawUrl.replace('/_local-packages', '');

  // Strip query string (bundlers add ?import to dynamic imports)
  const url = urlWithoutPrefix.split('?')[0] || '';

  // Parse the package name from URL (handles scoped packages like @scope/name)
  const match = url.match(/^\/@([^/]+)\/([^/@]+)(.*)$/);
  if (!match) {
    return false;
  }

  const [, scope, name, restPath] = match;
  const packageName = `@${scope}/${name}`;
  const localPath = ctx.localPackages[packageName];

  if (!localPath) {
    res.writeHead(404);
    res.end(`Package ${packageName} not found in local overrides`);
    return true;
  }

  // Determine what file to serve
  const rest = restPath || '';
  let filePath: string;

  try {
    if (rest === '/package.json') {
      filePath = path.join(localPath, 'package.json');
    } else if (rest === '' || rest === '/') {
      const pkgJson = JSON.parse(
        fs.readFileSync(path.join(localPath, 'package.json'), 'utf-8'),
      );
      const mainEntry = pkgJson.main || 'dist/index.js';
      filePath = path.join(localPath, mainEntry);
    } else {
      const normalizedPath = rest.startsWith('/') ? rest.slice(1) : rest;
      const distPath = path.join(localPath, 'dist', normalizedPath);
      const rootPath = path.join(localPath, normalizedPath);
      filePath = fs.existsSync(distPath) ? distPath : rootPath;
    }
  } catch (err) {
    ctx.log('Error resolving file path:', err);
    res.writeHead(500);
    res.end(`Error resolving path for ${packageName}: ${err}`);
    return true;
  }

  try {
    ctx.log(`Serving ${filePath}`);
    const content = fs.readFileSync(filePath, 'utf-8');
    const ext = path.extname(filePath);
    const contentType =
      ext === '.json'
        ? 'application/json'
        : ext === '.js'
        ? 'application/javascript'
        : ext === '.ts'
        ? 'application/typescript'
        : 'text/plain';
    res.setHeader('Content-Type', contentType);
    res.writeHead(200);
    res.end(content);
  } catch (err) {
    ctx.log('Error serving file:', filePath, err);
    res.writeHead(404);
    res.end(`File not found: ${filePath}`);
  }

  return true;
}
