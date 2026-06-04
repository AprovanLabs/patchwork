import type { Manifest } from "@aprovan/patchwork-compiler";

export interface FileStats {
  size: number;
  mtime: Date;
  isFile(): boolean;
  isDirectory(): boolean;
}

export interface DirEntry {
  name: string;
  isFile(): boolean;
  isDirectory(): boolean;
}

export interface FSProvider {
  readFile(path: string, encoding?: "utf8" | "base64"): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  unlink(path: string): Promise<void>;
  stat(path: string): Promise<FileStats>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  readdir(path: string): Promise<DirEntry[]>;
  rmdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  exists(path: string): Promise<boolean>;
}

export interface StoredWidget {
  path: string;
  resourceUri: string;
  html: string;
  manifest: Manifest;
  entry?: string;
  createdAt: number;
}

export interface StoredWidgetInfo {
  path: string;
  resourceUri: string;
  name: string;
  version: string;
  description?: string;
  services?: string[];
  entry?: string;
  createdAt: number;
}

export interface WidgetStoreOptions {
  storageDir?: string;
  backend?: FSProvider;
}
