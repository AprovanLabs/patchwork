export type FileCategory = 'compilable' | 'text' | 'media' | 'binary';

export interface FileTypeInfo {
  category: FileCategory;
  language: string | null;
  mimeType: string;
}

const COMPILABLE_EXTENSIONS = ['.tsx', '.jsx', '.ts', '.js'];
const MEDIA_EXTENSIONS = ['.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.mp4', '.mov', '.webm'];
const TEXT_EXTENSIONS = ['.json', '.yaml', '.yml', '.md', '.txt', '.css', '.html', '.xml', '.toml'];

const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  '.tsx': 'tsx',
  '.jsx': 'jsx',
  '.ts': 'typescript',
  '.js': 'javascript',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.md': 'markdown',
  '.txt': 'text',
  '.css': 'css',
  '.html': 'html',
  '.xml': 'xml',
  '.toml': 'toml',
  '.svg': 'xml',
};

const EXTENSION_TO_MIME: Record<string, string> = {
  '.tsx': 'text/typescript-jsx',
  '.jsx': 'text/javascript-jsx',
  '.ts': 'text/typescript',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.css': 'text/css',
  '.html': 'text/html',
  '.xml': 'application/xml',
  '.toml': 'text/toml',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
};

function getExtension(path: string): string {
  const lastDot = path.lastIndexOf('.');
  if (lastDot === -1) return '';
  return path.slice(lastDot).toLowerCase();
}

export function getFileType(path: string): FileTypeInfo {
  const ext = getExtension(path);

  if (COMPILABLE_EXTENSIONS.includes(ext)) {
    return {
      category: 'compilable',
      language: EXTENSION_TO_LANGUAGE[ext] ?? null,
      mimeType: EXTENSION_TO_MIME[ext] ?? 'text/plain',
    };
  }

  if (TEXT_EXTENSIONS.includes(ext)) {
    return {
      category: 'text',
      language: EXTENSION_TO_LANGUAGE[ext] ?? null,
      mimeType: EXTENSION_TO_MIME[ext] ?? 'text/plain',
    };
  }

  if (MEDIA_EXTENSIONS.includes(ext)) {
    return {
      category: 'media',
      language: ext === '.svg' ? 'xml' : null,
      mimeType: EXTENSION_TO_MIME[ext] ?? 'application/octet-stream',
    };
  }

  return {
    category: 'binary',
    language: null,
    mimeType: 'application/octet-stream',
  };
}

export function isCompilable(path: string): boolean {
  return COMPILABLE_EXTENSIONS.includes(getExtension(path));
}

export function isMediaFile(path: string): boolean {
  return MEDIA_EXTENSIONS.includes(getExtension(path));
}

export function isTextFile(path: string): boolean {
  return TEXT_EXTENSIONS.includes(getExtension(path));
}

export function getLanguageFromExt(path: string): string | null {
  const ext = getExtension(path);
  return EXTENSION_TO_LANGUAGE[ext] ?? null;
}

export function getMimeType(path: string): string {
  const ext = getExtension(path);
  return EXTENSION_TO_MIME[ext] ?? 'application/octet-stream';
}

export function isImageFile(path: string): boolean {
  const ext = getExtension(path);
  return ['.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext);
}

export function isVideoFile(path: string): boolean {
  const ext = getExtension(path);
  return ['.mp4', '.mov', '.webm'].includes(ext);
}
