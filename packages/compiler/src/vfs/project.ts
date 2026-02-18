import type { VirtualFile, VirtualProject } from './types.js';

export function createProjectFromFiles(
  files: VirtualFile[],
  id = crypto.randomUUID(),
): VirtualProject {
  const fileMap = new Map<string, VirtualFile>();
  for (const file of files) {
    fileMap.set(file.path, file);
  }
  return { id, entry: resolveEntry(fileMap), files: fileMap };
}

export function resolveEntry(files: Map<string, VirtualFile>): string {
  const paths = Array.from(files.keys());

  const mainFile = paths.find((p) => /\bmain\.(tsx?|jsx?)$/.test(p));
  if (mainFile) return mainFile;

  const indexFile = paths.find((p) => /\bindex\.(tsx?|jsx?)$/.test(p));
  if (indexFile) return indexFile;

  const firstTsx = paths.find((p) => /\.(tsx|jsx)$/.test(p));
  if (firstTsx) return firstTsx;

  return paths[0] || 'main.tsx';
}

export function detectMainFile(language?: string): string {
  switch (language) {
    case 'tsx':
    case 'typescript':
      return 'main.tsx';
    case 'jsx':
    case 'javascript':
      return 'main.jsx';
    case 'ts':
      return 'main.ts';
    case 'js':
      return 'main.js';
    default:
      return 'main.tsx';
  }
}

export function createSingleFileProject(
  content: string,
  entry = 'main.tsx',
  id = 'inline',
): VirtualProject {
  return {
    id,
    entry,
    files: new Map([[entry, { path: entry, content }]]),
  };
}
