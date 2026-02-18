export interface VirtualFile {
  path: string;
  content: string;
  language?: string;
  note?: string;
}

export interface VirtualProject {
  id: string;
  entry: string;
  files: Map<string, VirtualFile>;
}

export interface StorageBackend {
  get(path: string): Promise<string | null>;
  put(path: string, content: string): Promise<void>;
  delete(path: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
  exists(path: string): Promise<boolean>;
}
