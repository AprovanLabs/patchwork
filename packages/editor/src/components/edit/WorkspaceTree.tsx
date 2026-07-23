/**
 * Workspace file tree built on `@pierre/trees`. Path-first: hand it a flat path
 * list and the library owns expansion, selection, and virtualization inside a
 * shadow root. We theme it through `--trees-*-override` custom properties that
 * alias the app's shadcn tokens — custom properties inherit across the shadow
 * boundary, so the tree tracks the `.dark` root class for free without any
 * JS theme wiring.
 *
 * The model is constructed once (useFileTree captures its options at mount), so
 * everything dynamic — callbacks, pinned set — is read through refs. Path-set
 * changes flow through `model.resetPaths`; a pin toggle only re-runs the row
 * decorator, which reads the same ref.
 */
import {
  FileTree as PierreTree,
  useFileTree,
  type UseFileTreeResult,
} from '@pierre/trees/react';
import { Pencil, Pin, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useCallbackRef } from './useCallbackRef';
import type {
  ContextMenuItem,
  ContextMenuOpenContext,
  FileTreeOptions,
  FileTreeRowDecoration,
} from '@pierre/trees';

type PierreModel = UseFileTreeResult['model'];

export interface WorkspaceTreeProps {
  /** Full flat list of workspace paths (files and, implicitly, directories). */
  paths: string[];
  /** Externally selected path — mirrored into the tree's highlight. */
  activePath?: string;
  title?: string;
  className?: string;
  onSelectFile: (path: string) => void;
  onSelectDirectory?: (path: string) => void;
  /** The pencil / "Edit" action — opens the path in the editor session. */
  onOpenInEditor?: (path: string, isDir: boolean) => void;
  openInEditorTitle?: string;
  pinnedPaths?: Map<string, boolean>;
  onTogglePin?: (path: string, isDir: boolean) => void;
  onDeletePath?: (path: string, isDir: boolean) => void;
}

// Alias the app's shadcn tokens onto the tree's override variables. The tokens
// are full `oklch(…)` colors (Tailwind v4), so reference them directly and mint
// alpha tints with color-mix. Custom properties inherit across the shadow
// boundary and re-resolve there, so the tree swaps automatically when `.dark`
// flips on the root — no JS theme wiring.
const TREE_THEME_STYLE = {
  '--trees-bg-override': 'transparent',
  '--trees-fg-override': 'var(--foreground)',
  '--trees-fg-muted-override': 'var(--muted-foreground)',
  '--trees-bg-muted-override': 'color-mix(in oklch, var(--muted) 60%, transparent)',
  '--trees-selected-bg-override': 'color-mix(in oklch, var(--primary) 16%, transparent)',
  '--trees-selected-fg-override': 'var(--foreground)',
  '--trees-selected-focused-border-color-override':
    'color-mix(in oklch, var(--primary) 50%, transparent)',
  '--trees-accent-override': 'var(--primary)',
  '--trees-border-color-override': 'var(--border)',
  '--trees-indent-guide-bg-override': 'var(--border)',
  '--trees-focus-ring-color-override': 'var(--ring)',
  '--trees-scrollbar-thumb-override': 'color-mix(in oklch, var(--muted-foreground) 30%, transparent)',
  '--trees-input-bg-override': 'var(--background)',
  '--trees-search-bg-override': 'var(--background)',
  '--trees-search-fg-override': 'var(--foreground)',
  height: '100%',
  width: '100%',
} as React.CSSProperties;

/** Slotted into the tree's shadow root; lives in light DOM so Tailwind applies. */
function RowContextMenu({
  item,
  context,
  isPinned,
  openInEditorTitle,
  onOpenInEditor,
  onTogglePin,
  onDeletePath,
}: {
  item: ContextMenuItem;
  context: ContextMenuOpenContext;
  isPinned: boolean;
  openInEditorTitle: string;
  onOpenInEditor?: (path: string, isDir: boolean) => void;
  onTogglePin?: (path: string, isDir: boolean) => void;
  onDeletePath?: (path: string, isDir: boolean) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isDir = item.kind === 'directory';

  return (
    <div className="min-w-40 rounded-md border bg-popover text-popover-foreground shadow-md py-1 text-sm">
      {onOpenInEditor && (
        <button
          type="button"
          onClick={() => {
            onOpenInEditor(item.path, isDir);
            context.close();
          }}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-muted"
        >
          <Pencil className="h-3.5 w-3.5" />
          {openInEditorTitle}
        </button>
      )}
      {onTogglePin && (
        <button
          type="button"
          onClick={() => {
            onTogglePin(item.path, isDir);
            context.close();
          }}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-muted"
        >
          <Pin className="h-3.5 w-3.5" />
          {isPinned ? 'Unpin' : 'Pin'}
        </button>
      )}
      {onDeletePath && (
        <button
          type="button"
          onClick={() => {
            // Two-step confirm in place — the first click arms the control.
            if (!confirmDelete) {
              setConfirmDelete(true);
              return;
            }
            onDeletePath(item.path, isDir);
            context.close();
          }}
          className={`w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-destructive/10 text-destructive ${
            confirmDelete ? 'bg-destructive/10 font-medium' : ''
          }`}
        >
          <Trash2 className="h-3.5 w-3.5" />
          {confirmDelete ? `Really delete ${isDir ? 'folder' : 'file'}?` : 'Delete'}
        </button>
      )}
    </div>
  );
}

export function WorkspaceTree({
  paths,
  activePath,
  title = 'Files',
  className,
  onSelectFile,
  onSelectDirectory,
  onOpenInEditor,
  openInEditorTitle = 'Open in editor',
  pinnedPaths,
  onTogglePin,
  onDeletePath,
}: WorkspaceTreeProps) {
  // Refs keep the once-built model's captured closures pointed at fresh values.
  const modelRef = useRef<PierreModel | null>(null);
  const pinnedRef = useRef(pinnedPaths);
  const selectFileRef = useCallbackRef(onSelectFile);
  const selectDirRef = useCallbackRef(onSelectDirectory);
  // Suppresses the callback when we mirror an external `activePath` selection.
  const suppressRef = useRef(false);
  pinnedRef.current = pinnedPaths;

  const options = useRef<FileTreeOptions>({
    paths,
    initialExpansion: 'closed',
    density: 'compact',
    icons: { set: 'standard', colored: true },
    composition: {
      contextMenu: { enabled: true, triggerMode: 'both', buttonVisibility: 'when-needed' },
    },
    renderRowDecoration: ({ item }): FileTreeRowDecoration | null =>
      pinnedRef.current?.has(item.path) ? { text: '★', title: 'Pinned' } : null,
    onSelectionChange: (selected) => {
      const path = selected[selected.length - 1];
      if (!path || suppressRef.current) return;
      const isDir = modelRef.current?.getItem(path)?.isDirectory() ?? false;
      if (isDir) selectDirRef.current?.(path);
      else selectFileRef.current(path);
    },
  }).current;

  const { model } = useFileTree(options);
  modelRef.current = model;

  // Rebuild the tree when the path set changes (filter, refresh, delete). Skip
  // the first run — construction already seeded these paths and a reset here
  // would needlessly collapse the tree.
  const pathsKey = paths.join('\n');
  const firstPathsRun = useRef(true);
  useEffect(() => {
    if (firstPathsRun.current) {
      firstPathsRun.current = false;
      return;
    }
    model.resetPaths(paths);
  }, [pathsKey, model]);

  // Mirror external selection (e.g. a tab opened elsewhere) into the highlight
  // without echoing it back through onSelectionChange.
  useEffect(() => {
    if (!activePath || !model.getItem(activePath)) return;
    const current = model.getSelectedPaths();
    if (current[current.length - 1] === activePath) return;
    suppressRef.current = true;
    model.focusPath(activePath);
    model.scrollToPath(activePath, { focus: false });
    suppressRef.current = false;
  }, [activePath, pathsKey, model]);

  return (
    <div className={`flex flex-col min-h-0 text-foreground ${className ?? ''}`}>
      <div className="p-2 border-b text-xs font-medium text-muted-foreground uppercase tracking-wide shrink-0">
        {title}
      </div>
      {pinnedPaths && pinnedPaths.size > 0 && (
        <div className="px-2 py-1 border-b flex flex-wrap gap-1 shrink-0">
          {Array.from(pinnedPaths).map(([p, isDir]) => (
            <button
              key={p}
              type="button"
              onClick={() => (isDir ? onSelectDirectory?.(p) : onSelectFile(p))}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs hover:bg-muted/50 ${
                activePath === p ? 'bg-primary/10 text-primary' : 'text-muted-foreground'
              }`}
            >
              <Pin className="h-2.5 w-2.5 shrink-0" />
              <span className="truncate max-w-[120px]">{p.split('/').pop()}</span>
              {onTogglePin && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    onTogglePin(p, isDir);
                  }}
                  className="hover:text-destructive"
                >
                  <Trash2 className="h-2.5 w-2.5" />
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      <PierreTree
        model={model}
        style={TREE_THEME_STYLE}
        className="flex-1 min-h-0"
        renderContextMenu={(item, context) => (
          <RowContextMenu
            item={item}
            context={context}
            isPinned={pinnedRef.current?.has(item.path) ?? false}
            openInEditorTitle={openInEditorTitle}
            onOpenInEditor={onOpenInEditor}
            onTogglePin={onTogglePin}
            onDeletePath={onDeletePath}
          />
        )}
      />
    </div>
  );
}
