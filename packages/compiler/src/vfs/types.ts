export interface VirtualFile {
  path: string;
  content: string;
  language?: string;
  note?: string;
  encoding?: "utf8" | "base64";
}

export interface VirtualProject {
  id: string;
  entry: string;
  files: Map<string, VirtualFile>;
}
