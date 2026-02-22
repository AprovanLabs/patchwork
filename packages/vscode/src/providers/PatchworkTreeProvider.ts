import * as vscode from "vscode";
import type { VirtualProject } from "@aprovan/patchwork-compiler";

type TreeNodeKind = "empty" | "project" | "folder" | "file";

interface PatchworkTreeNode {
  label: string;
  kind: TreeNodeKind;
  projectId?: string;
  path?: string;
  children?: PatchworkTreeNode[];
}

export class PatchworkTreeItem extends vscode.TreeItem {
  readonly kind: TreeNodeKind;
  readonly projectId?: string;
  readonly path?: string;
  readonly children?: PatchworkTreeItem[];

  constructor(
    node: PatchworkTreeNode,
    collapsibleState: vscode.TreeItemCollapsibleState,
  ) {
    super(node.label, collapsibleState);
    this.kind = node.kind;
    this.projectId = node.projectId;
    this.path = node.path;
    this.children = node.children?.map(
      (child) =>
        new PatchworkTreeItem(
          child,
          child.children && child.children.length > 0
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None,
        ),
    );

    if (this.kind === "folder" || this.kind === "project") {
      this.iconPath = vscode.ThemeIcon.Folder;
    } else if (this.kind === "file") {
      this.iconPath = vscode.ThemeIcon.File;
      if (this.projectId && this.path) {
        this.command = {
          command: "patchwork.openFile",
          title: "Open Patchwork File",
          arguments: [this.projectId, this.path],
        };
        this.tooltip = this.path;
      }
    }
  }
}

export class PatchworkTreeProvider
  implements vscode.TreeDataProvider<PatchworkTreeItem>
{
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<
    PatchworkTreeItem | undefined
  >();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private readonly projects = new Map<string, VirtualProject>();

  setProject(id: string, project: VirtualProject): void {
    this.projects.set(id, project);
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  clearProjects(): void {
    this.projects.clear();
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  getTreeItem(element: PatchworkTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: PatchworkTreeItem): Thenable<PatchworkTreeItem[]> {
    if (!element) {
      if (this.projects.size === 0) {
        return Promise.resolve([
          new PatchworkTreeItem(
            { label: "No Patchwork projects", kind: "empty" },
            vscode.TreeItemCollapsibleState.None,
          ),
        ]);
      }

      const projectItems = Array.from(this.projects.values())
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(
          (project) =>
            new PatchworkTreeItem(
              {
                label: project.id,
                kind: "project",
                projectId: project.id,
                children: this.buildProjectNodes(project),
              },
              vscode.TreeItemCollapsibleState.Collapsed,
            ),
        );

      return Promise.resolve(projectItems);
    }

    if (element.children) {
      return Promise.resolve(element.children);
    }

    return Promise.resolve([]);
  }

  private buildProjectNodes(project: VirtualProject): PatchworkTreeNode[] {
    type InternalNode = {
      label: string;
      kind: TreeNodeKind;
      projectId: string;
      path: string;
      children: Map<string, InternalNode>;
    };

    const root: InternalNode = {
      label: project.id,
      kind: "project",
      projectId: project.id,
      path: "",
      children: new Map(),
    };

    for (const [path] of project.files) {
      const parts = path.split("/").filter(Boolean);
      let current = root;
      let currentPath = "";

      for (let index = 0; index < parts.length; index += 1) {
        const part = parts[index];
        const isFile = index === parts.length - 1;
        currentPath = currentPath ? `${currentPath}/${part}` : part;

        if (!current.children.has(part)) {
          current.children.set(part, {
            label: part,
            kind: isFile ? "file" : "folder",
            projectId: project.id,
            path: currentPath,
            children: new Map(),
          });
        }

        const next = current.children.get(part);
        if (next) current = next;
      }
    }

    const collectChildren = (
      nodeMap: Map<string, InternalNode>,
    ): PatchworkTreeNode[] => {
      const nodes = Array.from(nodeMap.values());
      return nodes
        .sort((a, b) => {
          if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
          return a.label.localeCompare(b.label);
        })
        .map((node) => ({
          label: node.label,
          kind: node.kind,
          projectId: node.projectId,
          path: node.path,
          children:
            node.kind === "file" ? undefined : collectChildren(node.children),
        }));
    };

    return collectChildren(root.children);
  }
}
