import { useMemo, useState } from 'react';
import { ChevronRight, ChevronDown, File, Folder } from 'lucide-react';
import type { VirtualFile } from '@aprovan/patchwork-compiler';

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeNode[];
}

function buildTree(files: VirtualFile[]): TreeNode {
  const root: TreeNode = { name: '', path: '', isDir: true, children: [] };

  for (const file of files) {
    const parts = file.path.split('/');
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      const isLast = i === parts.length - 1;
      const currentPath = parts.slice(0, i + 1).join('/');

      let child = current.children.find(c => c.name === part);
      if (!child) {
        child = {
          name: part,
          path: currentPath,
          isDir: !isLast,
          children: [],
        };
        current.children.push(child);
      }
      current = child;
    }
  }

  root.children.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return root;
}

interface TreeNodeComponentProps {
  node: TreeNode;
  activeFile: string;
  onSelect: (path: string) => void;
  depth?: number;
}

function TreeNodeComponent({ node, activeFile, onSelect, depth = 0 }: TreeNodeComponentProps) {
  const [expanded, setExpanded] = useState(true);

  if (!node.name) {
    return (
      <>
        {node.children.map(child => (
          <TreeNodeComponent
            key={child.path}
            node={child}
            activeFile={activeFile}
            onSelect={onSelect}
            depth={depth}
          />
        ))}
      </>
    );
  }

  const isActive = node.path === activeFile;

  if (node.isDir) {
    return (
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 w-full px-2 py-1 text-left text-sm hover:bg-muted/50 rounded"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          {expanded ? (
            <ChevronDown className="h-3 w-3 shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0" />
          )}
          <Folder className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span className="truncate">{node.name}</span>
        </button>
        {expanded && (
          <div>
            {node.children.map(child => (
              <TreeNodeComponent
                key={child.path}
                node={child}
                activeFile={activeFile}
                onSelect={onSelect}
                depth={depth + 1}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={() => onSelect(node.path)}
      className={`flex items-center gap-1 w-full px-2 py-1 text-left text-sm hover:bg-muted/50 rounded ${
        isActive ? 'bg-primary/10 text-primary' : ''
      }`}
      style={{ paddingLeft: `${depth * 12 + 20}px` }}
    >
      <File className="h-3 w-3 shrink-0 text-muted-foreground" />
      <span className="truncate">{node.name}</span>
    </button>
  );
}

export interface FileTreeProps {
  files: VirtualFile[];
  activeFile: string;
  onSelectFile: (path: string) => void;
}

export function FileTree({ files, activeFile, onSelectFile }: FileTreeProps) {
  const tree = useMemo(() => buildTree(files), [files]);

  return (
    <div className="w-48 border-r bg-muted/30 overflow-auto text-foreground">
      <div className="p-2 border-b text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Files
      </div>
      <div className="p-1">
        <TreeNodeComponent
          node={tree}
          activeFile={activeFile}
          onSelect={onSelectFile}
        />
      </div>
    </div>
  );
}
