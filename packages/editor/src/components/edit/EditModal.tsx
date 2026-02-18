import { useState, useCallback, useMemo, type ReactNode } from 'react';
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
import { MarkdownEditor } from '../MarkdownEditor';
import { EditHistory } from './EditHistory';
import { FileTree } from './FileTree';
import { useEditSession, type UseEditSessionOptions } from './useEditSession';
import { getActiveContent, getFiles } from './types';
import { Bobbin, serializeChangesToYAML, type Change } from '@aprovan/bobbin';

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
  onClose: (finalCode: string, editCount: number) => void;
  renderPreview: (code: string) => ReactNode;
  renderLoading?: () => ReactNode;
  renderError?: (error: string) => ReactNode;
  previewError?: string | null;
  previewLoading?: boolean;
}

export function EditModal({
  isOpen,
  onClose,
  renderPreview,
  renderLoading,
  renderError,
  previewError,
  previewLoading,
  ...sessionOptions
}: EditModalProps) {
  const [showPreview, setShowPreview] = useState(true);
  const [showTree, setShowTree] = useState(false);
  const [editInput, setEditInput] = useState('');
  const [bobbinChanges, setBobbinChanges] = useState<Change[]>([]);
  const [previewContainer, setPreviewContainer] = useState<HTMLDivElement | null>(null);

  const session = useEditSession(sessionOptions);
  const code = getActiveContent(session);
  const files = useMemo(() => getFiles(session.project), [session.project]);
  const hasChanges = code !== (session.originalProject.files.get(session.activeFile)?.content ?? '');

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

  const handleClose = () => {
    const editCount = session.history.length;
    const finalCode = code;
    setEditInput('');
    session.clearError();
    onClose(finalCode, editCount);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-8">
      <div className="flex flex-col bg-background rounded-lg shadow-xl w-full h-full max-w-6xl max-h-[90vh] overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 bg-background border-b-2">
          <Pencil className="h-4 w-4 text-primary" />
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
            <button
              onClick={() => setShowTree(!showTree)}
              className={`px-2 py-1 text-xs rounded flex items-center gap-1 ${showTree ? 'bg-primary text-primary-foreground' : 'hover:bg-primary/20 text-primary'}`}
              title={showTree ? 'Single file' : 'File tree'}
            >
              {showTree ? <FileCode className="h-3 w-3" /> : <FolderTree className="h-3 w-3" />}
            </button>
            <button
              onClick={() => setShowPreview(!showPreview)}
              className={`px-2 py-1 text-xs rounded flex items-center gap-1 ${showPreview ? 'bg-primary text-primary-foreground' : 'hover:bg-primary/20 text-primary'}`}
            >
              {showPreview ? <Eye className="h-3 w-3" /> : <Code className="h-3 w-3" />}
              {showPreview ? 'Preview' : 'Code'}
            </button>
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

        <div className="flex-1 min-h-0 border-b-2 overflow-hidden flex">
          {showTree && (
            <FileTree
              files={files}
              activeFile={session.activeFile}
              onSelectFile={session.setActiveFile}
            />
          )}
          <div className="flex-1 overflow-auto">
            {showPreview ? (
              <div className="bg-white h-full relative" ref={setPreviewContainer}>
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
                {!renderLoading && !renderError && !previewLoading && <Bobbin
                  container={previewContainer}
                  pillContainer={previewContainer}
                  defaultActive={false}
                  showInspector
                  onChanges={handleBobbinChanges}
                  exclude={['.bobbin-pill', '[data-bobbin]']}
                />}
              </div>
            ) : (
              <div className="p-4 bg-muted/10 h-full overflow-auto">
                <pre className="text-xs whitespace-pre-wrap break-words m-0">
                  <code>{code}</code>
                </pre>
              </div>
            )}
          </div>
        </div>

        <EditHistory
          entries={session.history}
          streamingNotes={session.streamingNotes}
          isStreaming={session.isApplying}
          pendingPrompt={session.pendingPrompt}
          className="h-48"
        />

        {session.error && (
          <div className="px-4 py-2 bg-destructive/10 text-destructive text-sm flex items-center gap-2 border-t-2 border-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {session.error}
          </div>
        )}

        {bobbinChanges.length > 0 && (
          <div className="px-4 py-2 bg-blue-50 text-blue-700 text-sm flex items-center gap-2 border-t">
            <span>{bobbinChanges.length} visual change{bobbinChanges.length !== 1 ? 's' : ''}</span>
            <button
              onClick={() => setBobbinChanges([])}
              className="text-xs underline hover:no-underline"
            >
              Clear
            </button>
          </div>
        )}

        <div className="p-4 border-t-2 bg-primary/5 flex gap-2 items-end">
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
    </div>
  );
}
