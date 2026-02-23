import { useMemo, useState, useRef, useCallback, useEffect, type ReactNode } from 'react';
import {
  ChevronRight,
  ChevronDown,
  ChevronsDown,
  File,
  Folder,
  Upload,
  Pencil,
  Loader2,
  Pin,
  PinOff,
  X,
} from 'lucide-react';
import type { VirtualFile } from '@aprovan/patchwork-compiler';
import { isMediaFile } from './fileTypes';

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeNode[];
}

export interface FileTreeEntry {
  name: string;
  path: string;
  isDir: boolean;
}

export type FileTreeDirectoryLoader = (path: string) => Promise<FileTreeEntry[]>;

function sortNodes(nodes: TreeNode[]): void {
  nodes.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  for (const node of nodes) {
    if (node.children.length > 0) {
      sortNodes(node.children);
    }
  }
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

  sortNodes(root.children);

  return root;
}

interface TreeNodeComponentProps {
  node: TreeNode;
  activePath: string;
  onSelect: (path: string) => void;
  onSelectDirectory?: (path: string) => void;
  onReplaceFile?: (path: string, content: string, encoding: 'utf8' | 'base64') => void;
  onOpenInEditor?: (path: string, isDir: boolean) => void;
  openInEditorMode?: 'files' | 'directories' | 'all';
  openInEditorIcon?: ReactNode;
  openInEditorTitle?: string;
  pinnedPaths?: Map<string, boolean>;
  onTogglePin?: (path: string, isDir: boolean) => void;
  pageSize?: number;
  depth?: number;
}

function TreeNodeComponent({
  node,
  activePath,
  onSelect,
  onSelectDirectory,
  onReplaceFile,
  onOpenInEditor,
  openInEditorMode = 'files',
  openInEditorIcon,
  openInEditorTitle = 'Open in editor',
  pinnedPaths,
  onTogglePin,
  pageSize = 10,
  depth = 0,
}: TreeNodeComponentProps) {
  const [expanded, setExpanded] = useState(false);
  const [visibleCount, setVisibleCount] = useState(pageSize);
  const [isHovered, setIsHovered] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUploadClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onReplaceFile) return;

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1] ?? '';
      onReplaceFile(node.path, base64, 'base64');
    };
    reader.readAsDataURL(file);

    e.target.value = '';
  }, [node.path, onReplaceFile]);

  const isPinned = pinnedPaths?.has(node.path) ?? false;
  const showPin = onTogglePin && isHovered;

  const handleTogglePin = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onTogglePin?.(node.path, node.isDir);
  }, [node.path, node.isDir, onTogglePin]);

  if (!node.name) {
    return (
      <>
        {node.children.map(child => (
          <TreeNodeComponent
            key={child.path}
            node={child}
            activePath={activePath}
            onSelect={onSelect}
            onSelectDirectory={onSelectDirectory}
            onReplaceFile={onReplaceFile}
            onOpenInEditor={onOpenInEditor}
            openInEditorMode={openInEditorMode}
            openInEditorIcon={openInEditorIcon}
            openInEditorTitle={openInEditorTitle}
            pinnedPaths={pinnedPaths}
            onTogglePin={onTogglePin}
            pageSize={pageSize}
            depth={depth}
          />
        ))}
      </>
    );
  }

  const isActive = node.path === activePath;
  const isMedia = !node.isDir && isMediaFile(node.path);
  const showUpload = isMedia && isHovered && onReplaceFile;
  const showOpenInEditor =
    !!onOpenInEditor &&
    isHovered &&
    (openInEditorMode === 'all' || (openInEditorMode === 'directories' ? node.isDir : !node.isDir));

  const handleOpenInEditor = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onOpenInEditor?.(node.path, node.isDir);
    },
    [node.path, node.isDir, onOpenInEditor],
  );

  if (node.isDir) {
    return (
      <div>
        <button
          onClick={() => {
            onSelectDirectory?.(node.path);
            setExpanded(!expanded);
          }}
          className={`flex items-center gap-1 w-full px-2 py-1 text-left text-sm hover:bg-muted/50 rounded ${
            isActive ? 'bg-primary/10 text-primary' : ''
          }`}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          {expanded ? (
            <ChevronDown className="h-3 w-3 shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0" />
          )}
          <Folder className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span className="truncate flex-1 flex pl-2">{node.name}</span>
          {(showPin || isPinned) && (
            <span
              onClick={handleTogglePin}
              className="p-1 hover:bg-primary/20 rounded cursor-pointer"
              title={isPinned ? 'Unpin' : 'Pin'}
            >
              {isPinned ? <PinOff className="h-3 w-3 text-primary" /> : <Pin className="h-3 w-3 text-muted-foreground" />}
            </span>
          )}
          {showOpenInEditor && (
            <span
              onClick={handleOpenInEditor}
              className="p-1 hover:bg-primary/20 rounded cursor-pointer"
              title={openInEditorTitle}
            >
              {openInEditorIcon ?? <Pencil className="h-3 w-3 text-primary" />}
            </span>
          )}
        </button>
        {expanded && (
          <div>
            {node.children.slice(0, visibleCount).map(child => (
              <TreeNodeComponent
                key={child.path}
                node={child}
                activePath={activePath}
                onSelect={onSelect}
                onSelectDirectory={onSelectDirectory}
                onReplaceFile={onReplaceFile}
                onOpenInEditor={onOpenInEditor}
                openInEditorMode={openInEditorMode}
                openInEditorIcon={openInEditorIcon}
                openInEditorTitle={openInEditorTitle}
                pinnedPaths={pinnedPaths}
                onTogglePin={onTogglePin}
                pageSize={pageSize}
                depth={depth + 1}
              />
            ))}
            {node.children.length > visibleCount && (
              <button
                onClick={() => setVisibleCount((prev) => prev + pageSize)}
                className="flex items-center gap-1 w-full px-2 py-1 text-left text-xs hover:bg-muted/50 rounded text-muted-foreground"
                style={{ paddingLeft: `${(depth + 1) * 12 + 20}px` }}
              >
                <ChevronsDown className="h-3 w-3 shrink-0" />
                <span>
                  Show {Math.min(pageSize, node.children.length - visibleCount)} more
                </span>
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className="relative"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <button
        onClick={() => onSelect(node.path)}
        className={`flex items-center gap-1 w-full px-2 py-1 text-left text-sm hover:bg-muted/50 rounded ${
          isActive ? 'bg-primary/10 text-primary' : ''
        }`}
        style={{ paddingLeft: `${depth * 12 + 20}px` }}
      >
        <File className="h-3 w-3 shrink-0 text-muted-foreground" />
        <span className="truncate flex-1 flex pl-2">{node.name}</span>
        {(showPin || isPinned) && (
          <span
            onClick={handleTogglePin}
            className="p-1 hover:bg-primary/20 rounded cursor-pointer"
            title={isPinned ? 'Unpin' : 'Pin'}
          >
            {isPinned ? <PinOff className="h-3 w-3 text-primary" /> : <Pin className="h-3 w-3 text-muted-foreground" />}
          </span>
        )}
        {showOpenInEditor && (
          <span
            onClick={handleOpenInEditor}
            className="p-1 hover:bg-primary/20 rounded cursor-pointer"
            title={openInEditorTitle}
          >
            {openInEditorIcon ?? <Pencil className="h-3 w-3 text-primary" />}
          </span>
        )}
        {showUpload && (
          <span
            onClick={handleUploadClick}
            className="p-1 hover:bg-primary/20 rounded cursor-pointer"
            title="Replace file"
          >
            <Upload className="h-3 w-3 text-primary" />
          </span>
        )}
      </button>
      {isMedia && (
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept="image/*,video/*"
          onChange={handleFileChange}
        />
      )}
    </div>
  );
}

export interface FileTreeProps {
  files?: VirtualFile[];
  activeFile?: string;
  activePath?: string;
  title?: string;
  onSelectFile: (path: string) => void;
  onSelectDirectory?: (path: string) => void;
  onReplaceFile?: (path: string, content: string, encoding: 'utf8' | 'base64') => void;
  onOpenInEditor?: (path: string, isDir: boolean) => void;
  openInEditorMode?: 'files' | 'directories' | 'all';
  openInEditorIcon?: ReactNode;
  openInEditorTitle?: string;
  pinnedPaths?: Map<string, boolean>;
  onTogglePin?: (path: string, isDir: boolean) => void;
  directoryLoader?: FileTreeDirectoryLoader;
  pageSize?: number;
  reloadToken?: number;
}

interface LazyTreeNodeProps {
  entry: FileTreeEntry;
  activePath: string;
  onSelectFile: (path: string) => void;
  onSelectDirectory?: (path: string) => void;
  onOpenInEditor?: (path: string, isDir: boolean) => void;
  openInEditorMode?: 'files' | 'directories' | 'all';
  openInEditorIcon?: ReactNode;
  openInEditorTitle?: string;
  pinnedPaths?: Map<string, boolean>;
  onTogglePin?: (path: string, isDir: boolean) => void;
  directoryLoader: FileTreeDirectoryLoader;
  pageSize: number;
  depth?: number;
  reloadToken?: number;
}

function LazyTreeNode({
  entry,
  activePath,
  onSelectFile,
  onSelectDirectory,
  onOpenInEditor,
  openInEditorMode = 'files',
  openInEditorIcon,
  openInEditorTitle = 'Open in editor',
  pinnedPaths,
  onTogglePin,
  directoryLoader,
  pageSize,
  depth = 0,
  reloadToken,
}: LazyTreeNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [children, setChildren] = useState<FileTreeEntry[] | null>(null);
  const [visibleCount, setVisibleCount] = useState(pageSize);

  useEffect(() => {
    setChildren(null);
    setVisibleCount(pageSize);
    if (expanded) {
      setLoading(true);
      setLoadError(null);
      directoryLoader(entry.path)
        .then((loaded) => setChildren(loaded))
        .catch((err) => setLoadError(err instanceof Error ? err.message : 'Failed to load directory'))
        .finally(() => setLoading(false));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadToken]);

  const isActive = entry.path === activePath;
  const isPinned = pinnedPaths?.has(entry.path) ?? false;
  const showPin = onTogglePin && isHovered;
  const showOpenInEditor =
    !!onOpenInEditor &&
    isHovered &&
    (openInEditorMode === 'all' || (openInEditorMode === 'directories' ? entry.isDir : !entry.isDir));

  const handleOpenInEditor = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onOpenInEditor?.(entry.path, entry.isDir);
    },
    [entry.path, entry.isDir, onOpenInEditor],
  );

  const handleTogglePin = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onTogglePin?.(entry.path, entry.isDir);
    },
    [entry.path, entry.isDir, onTogglePin],
  );

  const toggleDirectory = useCallback(async () => {
    if (!entry.isDir) return;
    onSelectDirectory?.(entry.path);

    if (!expanded && children === null) {
      setLoading(true);
      setLoadError(null);
      try {
        const loaded = await directoryLoader(entry.path);
        setChildren(loaded);
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : 'Failed to load directory');
      } finally {
        setLoading(false);
      }
    }

    setExpanded((prev) => !prev);
  }, [entry.isDir, entry.path, onSelectDirectory, expanded, children, directoryLoader]);

  if (!entry.isDir) {
    return (
      <div
        className="relative"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <button
          onClick={() => onSelectFile(entry.path)}
          className={`flex items-center gap-1 w-full px-2 py-1 text-left text-sm hover:bg-muted/50 rounded ${
            isActive ? 'bg-primary/10 text-primary' : ''
          }`}
          style={{ paddingLeft: `${depth * 12 + 20}px` }}
        >
          <File className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span className="truncate flex-1 flex pl-2">{entry.name}</span>
          {(showPin || isPinned) && (
            <span
              onClick={handleTogglePin}
              className="p-1 hover:bg-primary/20 rounded cursor-pointer"
              title={isPinned ? 'Unpin' : 'Pin'}
            >
              {isPinned ? <PinOff className="h-3 w-3 text-primary" /> : <Pin className="h-3 w-3 text-muted-foreground" />}
            </span>
          )}
          {showOpenInEditor && (
            <span
              onClick={handleOpenInEditor}
              className="p-1 hover:bg-primary/20 rounded cursor-pointer"
              title={openInEditorTitle}
            >
              {openInEditorIcon ?? <Pencil className="h-3 w-3 text-primary" />}
            </span>
          )}
        </button>
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={() => void toggleDirectory()}
        className={`flex items-center gap-1 w-full px-2 py-1 text-left text-sm hover:bg-muted/50 rounded ${
          isActive ? 'bg-primary/10 text-primary' : ''
        }`}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0" />
        )}
        <Folder className="h-3 w-3 shrink-0 text-muted-foreground" />
        <span className="truncate flex-1 flex pl-2">{entry.name}</span>
        {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        {(showPin || isPinned) && (
          <span
            onClick={handleTogglePin}
            className="p-1 hover:bg-primary/20 rounded cursor-pointer"
            title={isPinned ? 'Unpin' : 'Pin'}
          >
            {isPinned ? <PinOff className="h-3 w-3 text-primary" /> : <Pin className="h-3 w-3 text-muted-foreground" />}
          </span>
        )}
        {showOpenInEditor && (
          <span
            onClick={handleOpenInEditor}
            className="p-1 hover:bg-primary/20 rounded cursor-pointer"
            title={openInEditorTitle}
          >
            {openInEditorIcon ?? <Pencil className="h-3 w-3 text-primary" />}
          </span>
        )}
      </button>

      {expanded && (
        <div>
          {loadError && (
            <div
              className="px-2 py-1 text-xs text-destructive"
              style={{ paddingLeft: `${(depth + 1) * 12 + 20}px` }}
            >
              {loadError}
            </div>
          )}
          {(children ?? []).slice(0, visibleCount).map((child) => (
            <LazyTreeNode
              key={child.path}
              entry={child}
              activePath={activePath}
              onSelectFile={onSelectFile}
              onSelectDirectory={onSelectDirectory}
              onOpenInEditor={onOpenInEditor}
              openInEditorMode={openInEditorMode}
              openInEditorIcon={openInEditorIcon}
              openInEditorTitle={openInEditorTitle}
              pinnedPaths={pinnedPaths}
              onTogglePin={onTogglePin}
              directoryLoader={directoryLoader}
              pageSize={pageSize}
              depth={depth + 1}
              reloadToken={reloadToken}
            />
          ))}
          {(children?.length ?? 0) > visibleCount && (
            <button
              onClick={() => setVisibleCount((prev) => prev + pageSize)}
              className="flex items-center gap-1 w-full px-2 py-1 text-left text-xs hover:bg-muted/50 rounded text-muted-foreground"
              style={{ paddingLeft: `${(depth + 1) * 12 + 20}px` }}
            >
              <ChevronsDown className="h-3 w-3 shrink-0" />
              <span>
                Show {Math.min(pageSize, (children?.length ?? 0) - visibleCount)} more
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function FileTree({
  files = [],
  activeFile,
  activePath,
  title = 'Files',
  onSelectFile,
  onSelectDirectory,
  onReplaceFile,
  onOpenInEditor,
  openInEditorMode,
  openInEditorIcon,
  openInEditorTitle,
  pinnedPaths,
  onTogglePin,
  directoryLoader,
  pageSize = 10,
  reloadToken,
}: FileTreeProps) {
  const tree = useMemo(() => buildTree(files), [files]);
  const selectedPath = activePath ?? activeFile ?? '';
  const [rootEntries, setRootEntries] = useState<FileTreeEntry[]>([]);
  const [rootLoading, setRootLoading] = useState(false);
  const [rootError, setRootError] = useState<string | null>(null);

  useEffect(() => {
    if (!directoryLoader) return;

    let cancelled = false;

    const loadRoot = async () => {
      setRootLoading(true);
      setRootError(null);
      try {
        const entries = await directoryLoader('');
        if (!cancelled) {
          setRootEntries(entries);
        }
      } catch (err) {
        if (!cancelled) {
          setRootError(err instanceof Error ? err.message : 'Failed to load files');
        }
      } finally {
        if (!cancelled) {
          setRootLoading(false);
        }
      }
    };

    void loadRoot();

    return () => {
      cancelled = true;
    };
  }, [directoryLoader, reloadToken]);

  return (
    <div className="min-w-48 border-r bg-muted/30 overflow-auto text-foreground">
      <div className="p-2 border-b text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {title}
      </div>
      {pinnedPaths && pinnedPaths.size > 0 && (
        <div className="px-2 py-1 border-b flex flex-wrap gap-1">
          {Array.from(pinnedPaths).map(([p, isDir]) => (
            <button
              key={p}
              onClick={() => isDir ? onSelectDirectory?.(p) : onSelectFile(p)}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs hover:bg-muted/50 ${
                (activePath ?? activeFile ?? '') === p ? 'bg-primary/10 text-primary' : 'text-muted-foreground'
              }`}
            >
              {isDir ? <Folder className="h-2.5 w-2.5 shrink-0" /> : <Pin className="h-2.5 w-2.5 shrink-0" />}
              <span className="truncate max-w-[120px]">{p.split('/').pop()}</span>
              {onTogglePin && (
                <span
                  onClick={(e) => { e.stopPropagation(); onTogglePin(p, isDir); }}
                  className="hover:text-destructive"
                >
                  <X className="h-2.5 w-2.5" />
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      <div className="p-1">
        {directoryLoader ? (
          <>
            {rootLoading && (
              <div className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>Loading...</span>
              </div>
            )}
            {rootError && (
              <div className="px-2 py-1 text-xs text-destructive">{rootError}</div>
            )}
            {rootEntries.map((entry) => (
              <LazyTreeNode
                key={entry.path}
                entry={entry}
                activePath={selectedPath}
                onSelectFile={onSelectFile}
                onSelectDirectory={onSelectDirectory}
                onOpenInEditor={onOpenInEditor}
                openInEditorMode={openInEditorMode}
                openInEditorIcon={openInEditorIcon}
                openInEditorTitle={openInEditorTitle}
                pinnedPaths={pinnedPaths}
                onTogglePin={onTogglePin}
                directoryLoader={directoryLoader}
                pageSize={pageSize}
                reloadToken={reloadToken}
              />
            ))}
          </>
        ) : (
          <TreeNodeComponent
            node={tree}
            activePath={selectedPath}
            onSelect={onSelectFile}
            onSelectDirectory={onSelectDirectory}
            onReplaceFile={onReplaceFile}
            onOpenInEditor={onOpenInEditor}
            openInEditorMode={openInEditorMode}
            openInEditorIcon={openInEditorIcon}
            openInEditorTitle={openInEditorTitle}
            pinnedPaths={pinnedPaths}
            onTogglePin={onTogglePin}
            pageSize={pageSize}
          />
        )}
      </div>
    </div>
  );
}
