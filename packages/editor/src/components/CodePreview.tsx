import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Code, Eye, Pencil, RotateCcw, MessageSquare } from 'lucide-react';
import type { Compiler, Manifest } from '@aprovan/patchwork-compiler';
import { createSingleFileProject } from '@aprovan/patchwork-compiler';
import { EditModal, type CompileFn, CodeBlockView, MediaPreview, getFileType } from './edit';
import { SaveStatusButton, type SaveStatus } from './SaveStatusButton';
import { WidgetPreview } from './WidgetPreview';
import { MarkdownPreview } from './MarkdownPreview';
import { saveProject, getVFSConfig, loadFile, subscribeToChanges } from '../lib/vfs';
import type { VirtualProject } from '@aprovan/patchwork-compiler';

interface CodePreviewProps {
  code: string;
  compiler: Compiler | null;
  /** Optional entrypoint file for the widget (default: "index.ts") */
  entrypoint?: string;
  /** Available service namespaces for widget calls */
  services?: string[];
  /** Optional file path from code block attributes (e.g., "components/calculator.tsx") */
  filePath?: string;
  /** Optional callback to open a shared edit session outside this component */
  onOpenEditSession?: (session: {
    projectId: string;
    entryFile: string;
    filePath?: string;
    initialCode: string;
    initialProject: VirtualProject;
  }) => void;
}

function createManifest(services?: string[]): Manifest {
  return {
    name: 'preview',
    version: '1.0.0',
    platform: 'browser',
    image: '@aprovan/patchwork-image-shadcn',
    services,
  };
}

export function CodePreview({
  code: originalCode,
  compiler,
  services,
  filePath,
  entrypoint = 'index.ts',
  onOpenEditSession,
}: CodePreviewProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const [currentCode, setCurrentCode] = useState(originalCode);
  const [editCount, setEditCount] = useState(0);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [lastSavedCode, setLastSavedCode] = useState(originalCode);
  const [vfsPath, setVfsPath] = useState<string | null>(null);
  const currentCodeRef = useRef(currentCode);
  const lastSavedRef = useRef(lastSavedCode);
  const isEditingRef = useRef(isEditing);

  // Stable project ID for this widget instance (fallback when not using paths)
  const fallbackId = useMemo(() => crypto.randomUUID(), []);

  // Determine project ID based on server config and available path
  const getProjectId = useCallback(async () => {
    if (filePath) {
      const config = await getVFSConfig();
      if (config.usePaths) {
        // Use the directory containing the file as project ID
        const parts = filePath.split('/');
        if (parts.length > 1) {
          return parts.slice(0, -1).join('/');
        }
        // Single file, use filename without extension as ID
        return filePath.replace(/\.[^.]+$/, '');
      }
    }
    return fallbackId;
  }, [filePath, fallbackId]);

  // Get the entry filename
  const getEntryFile = useCallback(() => {
    if (filePath) {
      const parts = filePath.split('/');
      return parts[parts.length - 1] || entrypoint;
    }
    return entrypoint;
  }, [filePath]);

  useEffect(() => {
    currentCodeRef.current = currentCode;
  }, [currentCode]);

  useEffect(() => {
    lastSavedRef.current = lastSavedCode;
  }, [lastSavedCode]);

  useEffect(() => {
    isEditingRef.current = isEditing;
  }, [isEditing]);

  useEffect(() => {
    if (saveStatus === 'saving') return;
    if (currentCode === lastSavedCode) {
      if (saveStatus !== 'saved') setSaveStatus('saved');
      return;
    }
    if (saveStatus === 'saved') setSaveStatus('unsaved');
  }, [currentCode, lastSavedCode, saveStatus]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const projectId = await getProjectId();
      const entryFile = getEntryFile();
      if (!active) return;
      setVfsPath(`${projectId}/${entryFile}`);
    })();
    return () => {
      active = false;
    };
  }, [getProjectId, getEntryFile]);

  useEffect(() => {
    if (!vfsPath) return;
    const unsubscribe = subscribeToChanges(async (record) => {
      if (record.path !== vfsPath) return;
      if (record.type === 'delete') {
        setSaveStatus('unsaved');
        return;
      }
      if (isEditingRef.current) return;
      try {
        const remote = await loadFile(vfsPath);
        if (currentCodeRef.current !== lastSavedRef.current) {
          setSaveStatus('unsaved');
          return;
        }
        if (remote !== currentCodeRef.current) {
          setCurrentCode(remote);
          setLastSavedCode(remote);
          setSaveStatus('saved');
        }
      } catch {
        setSaveStatus('error');
      }
    });
    return () => unsubscribe();
  }, [vfsPath]);

  // Manual save handler
  const handleSave = useCallback(async () => {
    setSaveStatus('saving');
    try {
      const projectId = await getProjectId();
      const entryFile = getEntryFile();
      const project = createSingleFileProject(currentCode, entryFile, projectId);
      await saveProject(project);
      setLastSavedCode(currentCode);
      setSaveStatus('saved');
    } catch (err) {
      console.warn('[VFS] Failed to save project:', err);
      setSaveStatus('error');
    }
  }, [currentCode, getProjectId, getEntryFile]);

  const previewPath = filePath ?? entrypoint;
  const fileType = useMemo(() => getFileType(previewPath), [previewPath]);
  const canRenderWidget = fileType.category === 'compilable';

  const compile: CompileFn = useCallback(
    async (code: string) => {
      if (!canRenderWidget) return { success: true };
      if (!compiler) return { success: true };

      // Capture console.error outputs during compilation
      const errors: string[] = [];
      const originalError = console.error;
      console.error = (...args) => {
        errors.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
        originalError.apply(console, args);
      };

      try {
        await compiler.compile(
          code,
          createManifest(services),
          { typescript: true }
        );
        return { success: true };
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Compilation failed';
        const consoleErrors = errors.length > 0 ? `\n\nConsole errors:\n${errors.join('\n')}` : '';
        return {
          success: false,
          error: errorMessage + consoleErrors,
        };
      } finally {
        console.error = originalError;
      }
    },
    [canRenderWidget, compiler, services]
  );

  const handleRevert = () => {
    setCurrentCode(originalCode);
    setEditCount(0);
  };

  const hasChanges = currentCode !== originalCode;

  const previewBody = useMemo(() => {
    if (canRenderWidget) {
      return (
        <WidgetPreview
          code={currentCode}
          compiler={compiler}
          services={services}
          enabled={showPreview && !isEditing}
        />
      );
    }

    if (fileType.category === 'media') {
      return (
        <MediaPreview
          content={currentCode}
          mimeType={fileType.mimeType}
          fileName={previewPath}
        />
      );
    }

    if (fileType.language === 'markdown') {
      return (
        <div className="p-4 prose prose-sm dark:prose-invert max-w-none">
          <MarkdownPreview value={currentCode} />
        </div>
      );
    }

    return (
      <CodeBlockView
        content={currentCode}
        language={fileType.language}
      />
    );
  }, [canRenderWidget, compiler, currentCode, fileType, isEditing, previewPath, services, showPreview]);

  const handleOpenEditor = useCallback(async () => {
    if (!onOpenEditSession) {
      setIsEditing(true);
      return;
    }

    const projectId = await getProjectId();
    const entryFile = getEntryFile();
    const initialProject = createSingleFileProject(currentCode, entryFile, projectId);
    onOpenEditSession({
      projectId,
      entryFile,
      filePath,
      initialCode: currentCode,
      initialProject,
    });
  }, [onOpenEditSession, getProjectId, getEntryFile, currentCode, filePath]);

  return (
    <>
      <div className="border rounded-lg overflow-hidden min-w-0">
        <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 border-b rounded-t-lg">
          <Code className="h-4 w-4 text-muted-foreground" />
          {editCount > 0 && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <MessageSquare className="h-3 w-3" />
              {editCount} edit{editCount !== 1 ? 's' : ''}
            </span>
          )}
          <div className="ml-auto flex gap-1">
            {hasChanges && (
              <button
                onClick={handleRevert}
                className="px-2 py-1 text-xs rounded flex items-center gap-1 hover:bg-muted text-muted-foreground"
                title="Revert to original"
              >
                <RotateCcw className="h-3 w-3" />
              </button>
            )}
            <button
              onClick={() => void handleOpenEditor()}
              className="px-2 py-1 text-xs rounded flex items-center gap-1 hover:bg-muted"
              title="Edit component"
            >
              <Pencil className="h-3 w-3" />
            </button>
            <SaveStatusButton
              status={saveStatus}
              onClick={handleSave}
              disabled={saveStatus === 'saving'}
              tone="muted"
            />
            <button
              onClick={() => setShowPreview(!showPreview)}
              className={`w-[5rem] px-2 py-1 text-xs rounded flex items-center gap-1 ${showPreview ? 'bg-primary text-primary-foreground' : 'hover:bg-primary/20 text-primary'}`}
            >
              {showPreview ? <Eye className="h-3 w-3" /> : <Code className="h-3 w-3" />}
              {showPreview ? 'Preview' : 'Code'}
            </button>
          </div>
        </div>

        {showPreview ? (
          <div className="bg-white overflow-y-auto overflow-x-hidden max-h-[60vh]">
            {previewBody}
          </div>
        ) : (
          <div className="bg-muted/30 overflow-auto max-h-[60vh]">
            <CodeBlockView
              content={currentCode}
              language={fileType.language}
            />
          </div>
        )}
      </div>

      <EditModal
        isOpen={isEditing}
        onClose={(finalCode, edits) => {
          setCurrentCode(finalCode);
          setEditCount((prev) => prev + edits);
          setIsEditing(false);

          // Auto-save to VFS when edits complete
          if (edits > 0) {
            setSaveStatus('saving');
            (async () => {
              try {
                const projectId = await getProjectId();
                const entryFile = getEntryFile();
                const project = createSingleFileProject(finalCode, entryFile, projectId);
                await saveProject(project);
                setLastSavedCode(finalCode);
                setSaveStatus('saved');
              } catch (err) {
                console.warn('[VFS] Failed to save project:', err);
                setSaveStatus('error');
              }
            })();
          }
        }}
        originalCode={currentCode}
        compile={compile}
        renderPreview={(code) => (
          <WidgetPreview
            code={code}
            compiler={compiler}
            services={services}
          />
        )}
      />
    </>
  );
}
