import { Bobbin, serializeChangesToYAML, type Change } from '@aprovan/bobbin';
import {
  Code,
  Eye,
  AlertCircle,
  Loader2,
  Pencil,
  X,
  RotateCcw,
  Send,
  FolderTree,
  FileCode,
} from 'lucide-react';
import { useState, useCallback, useMemo, useRef, useEffect, type ReactNode } from 'react';
import { MarkdownEditor } from '../MarkdownEditor';
import { MarkdownPreview } from '../MarkdownPreview';
import { SaveStatusButton, type SaveStatus } from '../SaveStatusButton';
import { CodeBlockView } from './CodeBlockView';
import { EditHistory } from './EditHistory';
import { getFileType, isCompilable, isMarkdownFile, getMimeType } from './fileTypes';
import { MediaPreview } from './MediaPreview';
import { SaveConfirmDialog } from './SaveConfirmDialog';
import { getActiveContent, getFiles } from './types';
import { useEditSession, type UseEditSessionOptions } from './useEditSession';
import { WorkspaceTree } from './WorkspaceTree';
import type { VirtualProject } from '@aprovan/patchwork-compiler';

/** Read a picked media file as bare base64 (no data-URL prefix) for replaceFile. */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// Simple hash for React key to force re-render on code changes
function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash;
}


export interface EditModalProps extends UseEditSessionOptions {
  isOpen: boolean;
  initialTreePath?: string;
  initialState?: Partial<{
    showTree: boolean;
    showPreview: boolean;
  }>;
  hideFileTree?: boolean;
  onClose: (finalCode: string, editCount: number) => void;
  onSave?: (code: string) => Promise<void>;
  onSaveProject?: (project: VirtualProject) => Promise<void>;
  renderPreview: (code: string) => ReactNode;
  renderLoading?: () => ReactNode;
  renderError?: (error: string) => ReactNode;
  previewError?: string | null;
  previewLoading?: boolean;
}

export function EditModal({
  isOpen,
  onClose,
  onSave,
  onSaveProject,
  renderPreview,
  renderLoading,
  renderError,
  previewError,
  previewLoading,
  initialTreePath,
  initialState = {},
  hideFileTree = false,
  ...sessionOptions
}: EditModalProps) {
  const [showPreview, setShowPreview] = useState(initialState?.showPreview ?? true);
  const [showTree, setShowTree] = useState(
    hideFileTree ? false : (initialState?.showTree ?? false)
  );
  const [editInput, setEditInput] = useState('');
  const [bobbinChanges, setBobbinChanges] = useState<Change[]>([]);
  const [previewContainer, setPreviewContainer] = useState<HTMLDivElement | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [lastSavedSnapshot, setLastSavedSnapshot] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pendingClose, setPendingClose] = useState<{ code: string; count: number } | null>(null);
  const [treePath, setTreePath] = useState(initialTreePath ?? '');
  const wasOpenRef = useRef(false);
  const currentCodeRef = useRef<string>('');

  const session = useEditSession(sessionOptions);
  const code = getActiveContent(session);
  const effectiveTreePath = treePath || session.activeFile;
  currentCodeRef.current = code;
  const files = useMemo(() => getFiles(session.project), [session.project]);
  const treePaths = useMemo(() => files.map((f) => f.path), [files]);
  const activeFileName = session.activeFile.split('/').pop() ?? session.activeFile;
  const projectSnapshot = useMemo(
    () =>
      Array.from(session.project.files.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([path, file]) => `${path}\u0000${file.content}`)
        .join('\u0001'),
    [session.project]
  );
  const hasChanges = code !== (session.originalProject.files.get(session.activeFile)?.content ?? '');

  const fileType = useMemo(() => getFileType(session.activeFile), [session.activeFile]);
  const isCompilableFile = isCompilable(session.activeFile);
  const isMarkdown = isMarkdownFile(session.activeFile);
  const showPreviewToggle = isCompilableFile || isMarkdown;

  const handleBobbinChanges = useCallback((changes: Change[]) => {
    setBobbinChanges(changes);
  }, []);

  const handleSubmit = () => {
    if ((!editInput.trim() && bobbinChanges.length === 0) || session.isApplying) return;
    
    // Convert bobbin changes to YAML context
    let promptWithContext = editInput;
    
    if (bobbinChanges.length > 0) {
      const bobbinYaml = serializeChangesToYAML(bobbinChanges, []);
      promptWithContext = `${editInput}\n\n---\nVisual Changes (apply these styles/modifications):\n\`\`\`yaml\n${bobbinYaml}\n\`\`\``;
    }
    
    session.submitEdit(promptWithContext);
    setEditInput('');
    setBobbinChanges([]);
  };

  const hasSaveHandler = onSave || onSaveProject;

  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      setLastSavedSnapshot(projectSnapshot);
      setSaveStatus('saved');
      setSaveError(null);
    }
    wasOpenRef.current = isOpen;
  }, [isOpen, projectSnapshot]);

  useEffect(() => {
    if (!hasSaveHandler) return;
    if (projectSnapshot === lastSavedSnapshot) {
      if (saveStatus !== 'saving' && saveStatus !== 'saved') {
        setSaveStatus('saved');
      }
      return;
    }
    if (saveStatus === 'saved' || saveStatus === 'error') {
      setSaveStatus('unsaved');
    }
  }, [projectSnapshot, lastSavedSnapshot, saveStatus, hasSaveHandler]);

  const handleClose = useCallback(() => {
    const editCount = session.history.length;
    const finalCode = code;
    const hasUnsavedChanges = editCount > 0 && finalCode !== (session.originalProject.files.get(session.activeFile)?.content ?? '');
    
    if (hasUnsavedChanges && hasSaveHandler) {
      setPendingClose({ code: finalCode, count: editCount });
      setShowConfirm(true);
    } else {
      setEditInput('');
      session.clearError();
      onClose(finalCode, editCount);
    }
  }, [code, session, hasSaveHandler, onClose]);

  const handleSaveAndClose = useCallback(async () => {
    if (!pendingClose || !hasSaveHandler) return;
    setIsSaving(true);
    setSaveStatus('saving');
    setSaveError(null);
    try {
      if (onSaveProject) {
        await onSaveProject(session.project);
      } else if (onSave) {
        await onSave(pendingClose.code);
      }
      setLastSavedSnapshot(projectSnapshot);
      setSaveStatus('saved');
      setShowConfirm(false);
      setEditInput('');
      session.clearError();
      onClose(pendingClose.code, pendingClose.count);
      setPendingClose(null);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed');
      setSaveStatus('error');
    } finally {
      setIsSaving(false);
    }
  }, [pendingClose, onSave, onSaveProject, session, onClose, projectSnapshot, hasSaveHandler]);

  const handleDiscard = useCallback(() => {
    if (!pendingClose) return;
    setShowConfirm(false);
    setEditInput('');
    session.clearError();
    onClose(pendingClose.code, pendingClose.count);
    setPendingClose(null);
  }, [pendingClose, session, onClose]);

  const handleCancelClose = useCallback(() => {
    setShowConfirm(false);
    setPendingClose(null);
    setSaveError(null);
  }, []);

  const handleDirectSave = useCallback(async () => {
    if (!hasSaveHandler) return;
    setIsSaving(true);
    setSaveStatus('saving');
    setSaveError(null);
    try {
      if (onSaveProject) {
        await onSaveProject(session.project);
      } else if (onSave && currentCodeRef.current) {
        await onSave(currentCodeRef.current);
      }
      setLastSavedSnapshot(projectSnapshot);
      setSaveStatus('saved');
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed');
      setSaveStatus('error');
    } finally {
      setIsSaving(false);
    }
  }, [onSave, onSaveProject, session.project, hasSaveHandler, projectSnapshot]);

  if (!isOpen) return null;

  return (
    <>
    {/* Full-view editing surface — fills the viewport like an IDE panel, not a
        dialog floating in a scrim. */}
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
        <div className="flex items-center gap-2 px-4 py-2 bg-background border-b shrink-0">
          <Pencil className="h-4 w-4 text-primary shrink-0" />
          <span className="text-sm font-medium truncate max-w-[40vw]" title={session.activeFile}>
            {activeFileName}
          </span>
          {session.isApplying && (
            <span className="text-xs font-medium text-primary flex items-center gap-1 ml-2">
              <Loader2 className="h-3 w-3 animate-spin" />
              Applying edits...
            </span>
          )}
          <div className="ml-auto flex gap-2">
            {hasChanges && (
              <button
                onClick={session.revert}
                className="px-2 py-1 text-xs rounded flex items-center gap-1 hover:bg-primary/20 text-primary"
                title="Revert to original"
              >
                <RotateCcw className="h-3 w-3" />
              </button>
            )}
            {!hideFileTree && (
              <button
                onClick={() => setShowTree(!showTree)}
                className={`px-2 py-1 text-xs rounded flex items-center gap-1 ${showTree ? 'bg-primary text-primary-foreground' : 'hover:bg-primary/20 text-primary'}`}
                title={showTree ? 'Single file' : 'File tree'}
              >
                {showTree ? <FileCode className="h-3 w-3" /> : <FolderTree className="h-3 w-3" />}
              </button>
            )}
            {hasSaveHandler && (
              <SaveStatusButton
                status={saveStatus}
                onClick={handleDirectSave}
                disabled={isSaving}
                tone="primary"
              />
            )}
            {showPreviewToggle && (
              <button
                onClick={() => setShowPreview(!showPreview)}
                className={`w-[5rem] px-2 py-1 text-xs rounded flex items-center gap-1 ${showPreview ? 'bg-primary text-primary-foreground' : 'hover:bg-primary/20 text-primary'}`}
              >
                {showPreview ? <Eye className="h-3 w-3" /> : <Code className="h-3 w-3" />}
                {showPreview ? 'Preview' : 'Code'}
              </button>
            )}
            <button
              onClick={handleClose}
              className="px-2 py-1 text-xs rounded flex items-center gap-1 bg-primary text-primary-foreground hover:bg-primary/90"
              title="Exit edit mode"
            >
              <X className="h-3 w-3" />
              Done
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 border-b overflow-hidden flex">
          {!hideFileTree && showTree && (
            // `relative z-10` so the tree's context menu (absolute, in the tree's
            // shadow root) paints above the preview column that follows it.
            <aside className="relative z-10 w-64 max-w-[45vw] sm:max-w-none shrink-0 border-r bg-muted/20 flex flex-col min-h-0">
              <WorkspaceTree
                paths={treePaths}
                activePath={effectiveTreePath}
                onSelectFile={(path) => {
                  setTreePath(path);
                  session.setActiveFile(path);
                }}
                onSelectDirectory={(path) => setTreePath(path)}
                onOpenInEditor={(path) => {
                  setTreePath(path);
                  session.setActiveFile(path);
                }}
                openInEditorTitle="Open"
                onReplaceFile={(path, file) => {
                  void fileToBase64(file).then((base64) =>
                    session.replaceFile(path, base64, 'base64'),
                  );
                }}
                className="flex-1 min-h-0"
              />
            </aside>
          )}
          <div className="flex-1 min-w-0 overflow-auto">
            {fileType.category === 'compilable' && showPreview ? (
              <div className="bg-card h-full relative" ref={setPreviewContainer}>
                {previewError && renderError ? (
                  renderError(previewError)
                ) : previewError ? (
                  <div className="p-4 text-sm text-destructive flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span>{previewError}</span>
                  </div>
                ) : previewLoading && renderLoading ? (
                  renderLoading()
                ) : previewLoading ? (
                  <div className="p-4 flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm">Rendering preview...</span>
                  </div>
                ) : (
                  <div className="p-4" key={hashCode(code)}>{renderPreview(code)}</div>
                )}
                {/* Scoped to the preview surface — the widget it edits, not
                    the modal chrome around it. */}
                {!renderLoading && !renderError && !previewLoading && <Bobbin
                  container={previewContainer}
                  defaultActive={false}
                  showInspector
                  onChanges={handleBobbinChanges}
                  exclude={['.bobbin-pill', '[data-bobbin]']}
                />}
              </div>
            ) : fileType.category === 'compilable' && !showPreview ? (
              <CodeBlockView
                content={code}
                language={fileType.language}
                editable
                onChange={session.updateActiveFile}
              />
            ) : isMarkdown && showPreview ? (
              <div className="p-4 prose prose-sm dark:prose-invert max-w-none h-full overflow-auto">
                <MarkdownPreview
                  value={code}
                  editable
                  onChange={session.updateActiveFile}
                />
              </div>
            ) : fileType.category === 'text' ? (
              <CodeBlockView
                content={code}
                language={fileType.language}
                editable
                onChange={session.updateActiveFile}
              />
            ) : fileType.category === 'media' ? (
              <MediaPreview
                content={code}
                mimeType={getMimeType(session.activeFile)}
                fileName={session.activeFile.split('/').pop() ?? session.activeFile}
              />
            // Default to code view for unknown types
            ) : (
              <CodeBlockView
                content={code}
                language={fileType.language}
                editable
                onChange={session.updateActiveFile}
              />
            )}
          </div>
        </div>

        <div className="shrink-0">
          <EditHistory
            entries={session.history}
            streamingNotes={session.streamingNotes}
            isStreaming={session.isApplying}
            pendingPrompt={session.pendingPrompt}
            className="h-36 sm:h-48"
          />
        </div>

        {(session.error || saveError) && (
          <div className="px-4 py-2 bg-destructive/10 text-destructive text-sm flex items-center gap-2 border-t border-destructive shrink-0">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {session.error || saveError}
          </div>
        )}

        {bobbinChanges.length > 0 && (
          <div className="px-4 py-2 bg-blue-50 text-blue-700 text-sm flex items-center gap-2 border-t shrink-0">
            <span>{bobbinChanges.length} visual change{bobbinChanges.length !== 1 ? 's' : ''}</span>
            <button
              onClick={() => setBobbinChanges([])}
              className="text-xs underline hover:no-underline"
            >
              Clear
            </button>
          </div>
        )}

        <div className="p-4 border-t bg-primary/5 flex gap-2 items-end shrink-0">
          <div className="flex-1">
            <MarkdownEditor
              value={editInput}
              onChange={setEditInput}
              onSubmit={handleSubmit}
              placeholder="Describe changes..."
              disabled={session.isApplying}
            />
          </div>
          <button
            onClick={handleSubmit}
            disabled={(!editInput.trim() && bobbinChanges.length === 0) || session.isApplying}
            className="px-3 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1 shrink-0"
          >
            {session.isApplying ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </button>
        </div>
    </div>
    <SaveConfirmDialog
      isOpen={showConfirm}
      isSaving={isSaving}
      error={saveError}
      onSave={handleSaveAndClose}
      onDiscard={handleDiscard}
      onCancel={handleCancelClose}
    />
    </>
  );
}
