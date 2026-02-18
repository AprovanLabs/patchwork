import type { Plugin, Loader } from 'esbuild-wasm';
import type { VirtualProject } from '../vfs/types.js';

function dirname(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? '.' : path.slice(0, idx) || '.';
}

function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '..') parts.pop();
    else if (segment && segment !== '.') parts.push(segment);
  }
  return parts.join('/');
}

function inferLoader(path: string, language?: string): Loader {
  if (language) {
    switch (language) {
      case 'typescript':
      case 'ts':
        return 'ts';
      case 'tsx':
        return 'tsx';
      case 'javascript':
      case 'js':
        return 'js';
      case 'jsx':
        return 'jsx';
      case 'json':
        return 'json';
      case 'css':
        return 'css';
    }
  }
  const ext = path.split('.').pop();
  switch (ext) {
    case 'ts':
      return 'ts';
    case 'tsx':
      return 'tsx';
    case 'js':
      return 'js';
    case 'jsx':
      return 'jsx';
    case 'json':
      return 'json';
    case 'css':
      return 'css';
    default:
      return 'tsx';
  }
}

function normalizeVFSPath(path: string): string {
  if (path.startsWith('@/')) {
    return path.slice(2);
  }
  return path;
}

function resolveRelativePath(importer: string, target: string): string {
  const importerDir = dirname(normalizeVFSPath(importer));
  const combined = importerDir === '.' ? target : `${importerDir}/${target}`;
  return normalizePath(combined);
}

function matchAlias(
  importPath: string,
  aliases?: Record<string, string>,
): string | null {
  if (!aliases) return null;
  for (const [pattern, target] of Object.entries(aliases)) {
    if (pattern.endsWith('/*')) {
      const prefix = pattern.slice(0, -2);
      if (importPath === prefix || importPath.startsWith(prefix + '/')) {
        return target;
      }
    }
    if (importPath === pattern) {
      return target;
    }
  }
  return null;
}

function findFile(project: VirtualProject, path: string): string | null {
  if (project.files.has(path)) return path;
  const extensions = ['.tsx', '.ts', '.jsx', '.js', '.json'];
  for (const ext of extensions) {
    if (project.files.has(path + ext)) return path + ext;
  }
  for (const ext of extensions) {
    const indexPath = `${path}/index${ext}`;
    if (project.files.has(indexPath)) return indexPath;
  }
  return null;
}

export interface VFSPluginOptions {
  aliases?: Record<string, string>;
}

export function vfsPlugin(
  project: VirtualProject,
  options: VFSPluginOptions = {},
): Plugin {
  return {
    name: 'patchwork-vfs',
    setup(build) {
      build.onResolve({ filter: /^@\// }, (args) => {
        const aliased = matchAlias(args.path, options.aliases);
        if (aliased) return null;
        return { path: args.path, namespace: 'vfs' };
      });

      build.onResolve({ filter: /^\./ }, (args) => {
        if (args.namespace !== 'vfs') return null;
        const resolved = resolveRelativePath(args.importer, args.path);
        return { path: resolved, namespace: 'vfs' };
      });

      build.onLoad({ filter: /.*/, namespace: 'vfs' }, (args) => {
        const normalPath = normalizeVFSPath(args.path);
        const filePath = findFile(project, normalPath);
        if (!filePath) {
          throw new Error(`File not found in VFS: ${args.path}`);
        }
        const file = project.files.get(filePath)!;
        return {
          contents: file.content,
          loader: inferLoader(filePath, file.language),
        };
      });
    },
  };
}
