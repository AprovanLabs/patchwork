import * as vscode from "vscode";
import type { VirtualFile, VirtualProject } from "@aprovan/patchwork-compiler";

interface ParsedPatchworkUri {
  projectId: string;
  path: string;
}

export class PatchworkFileSystemProvider implements vscode.FileSystemProvider {
  private readonly onDidChangeFileEmitter = new vscode.EventEmitter<
    vscode.FileChangeEvent[]
  >();
  readonly onDidChangeFile = this.onDidChangeFileEmitter.event;

  private readonly projects = new Map<string, VirtualProject>();

  setProject(id: string, project: VirtualProject): void {
    this.projects.set(id, project);
    this.onDidChangeFileEmitter.fire([]);
  }

  clearProjects(): void {
    this.projects.clear();
    this.onDidChangeFileEmitter.fire([]);
  }

  readFile(uri: vscode.Uri): Uint8Array {
    const { projectId, path } = this.parseUri(uri);
    const project = this.getProject(projectId);
    const file = project.files.get(path);
    if (!file) throw vscode.FileSystemError.FileNotFound(uri);
    return this.encodeFileContent(file);
  }

  writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    options: { create: boolean; overwrite: boolean },
  ): void {
    const { projectId, path } = this.parseUri(uri);
    const project = this.getProject(projectId);
    const exists = project.files.has(path);
    if (!exists && !options.create) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    if (exists && !options.overwrite) {
      throw vscode.FileSystemError.FileExists(uri);
    }

    const file = this.decodeFileContent(path, content);
    project.files.set(path, file);
    this.onDidChangeFileEmitter.fire([
      {
        type: exists
          ? vscode.FileChangeType.Changed
          : vscode.FileChangeType.Created,
        uri,
      },
    ]);
  }

  stat(uri: vscode.Uri): vscode.FileStat {
    const { projectId, path } = this.parseUri(uri);
    const project = this.getProject(projectId);

    if (!path) {
      return {
        type: vscode.FileType.Directory,
        ctime: 0,
        mtime: 0,
        size: 0,
      };
    }

    const file = project.files.get(path);
    if (file) {
      return {
        type: vscode.FileType.File,
        ctime: 0,
        mtime: 0,
        size: this.encodeFileContent(file).byteLength,
      };
    }

    if (this.hasDirectory(project, path)) {
      return {
        type: vscode.FileType.Directory,
        ctime: 0,
        mtime: 0,
        size: 0,
      };
    }

    throw vscode.FileSystemError.FileNotFound(uri);
  }

  readDirectory(uri: vscode.Uri): [string, vscode.FileType][] {
    const { projectId, path } = this.parseUri(uri);
    const project = this.getProject(projectId);
    return this.listDirectoryEntries(project, path);
  }

  createDirectory(): void {
    throw vscode.FileSystemError.NoPermissions(
      "Patchwork file system is read/write via file edits only.",
    );
  }

  delete(): void {
    throw vscode.FileSystemError.NoPermissions(
      "Patchwork file deletion is not implemented yet.",
    );
  }

  rename(): void {
    throw vscode.FileSystemError.NoPermissions(
      "Patchwork file rename is not implemented yet.",
    );
  }

  watch(): vscode.Disposable {
    return new vscode.Disposable(() => undefined);
  }

  private parseUri(uri: vscode.Uri): ParsedPatchworkUri {
    if (uri.scheme !== "patchwork") {
      throw vscode.FileSystemError.Unavailable(
        "Unsupported URI scheme for Patchwork provider.",
      );
    }
    const projectId = uri.authority;
    if (!projectId) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    const path = uri.path.replace(/^\/+/, "");
    return { projectId, path };
  }

  private getProject(projectId: string): VirtualProject {
    const project = this.projects.get(projectId);
    if (!project) {
      throw vscode.FileSystemError.FileNotFound(
        vscode.Uri.parse(`patchwork://${projectId}`),
      );
    }
    return project;
  }

  private encodeFileContent(file: VirtualFile): Uint8Array {
    if (file.encoding === "base64") {
      return Buffer.from(file.content, "base64");
    }
    return Buffer.from(file.content, "utf8");
  }

  private decodeFileContent(path: string, content: Uint8Array): VirtualFile {
    const hasNull = content.some((byte) => byte === 0);
    if (hasNull) {
      return {
        path,
        content: Buffer.from(content).toString("base64"),
        encoding: "base64",
      };
    }

    return {
      path,
      content: Buffer.from(content).toString("utf8"),
      encoding: "utf8",
    };
  }

  private hasDirectory(project: VirtualProject, path: string): boolean {
    const prefix = path.endsWith("/") ? path : `${path}/`;
    for (const filePath of project.files.keys()) {
      if (filePath.startsWith(prefix)) return true;
    }
    return false;
  }

  private listDirectoryEntries(
    project: VirtualProject,
    path: string,
  ): [string, vscode.FileType][] {
    const prefix = path ? `${path.replace(/\/+$/, "")}/` : "";
    const entries = new Map<string, vscode.FileType>();

    for (const filePath of project.files.keys()) {
      if (!filePath.startsWith(prefix)) continue;
      const remainder = filePath.slice(prefix.length);
      if (!remainder) continue;
      const [segment, ...rest] = remainder.split("/");
      if (!segment) continue;
      if (rest.length === 0) {
        entries.set(segment, vscode.FileType.File);
      } else if (!entries.has(segment)) {
        entries.set(segment, vscode.FileType.Directory);
      }
    }

    return Array.from(entries.entries()).sort((a, b) =>
      a[0].localeCompare(b[0]),
    );
  }
}
