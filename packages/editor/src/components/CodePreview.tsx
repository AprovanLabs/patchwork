import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Code, Eye, AlertCircle, Loader2, Pencil, RotateCcw, MessageSquare, Cloud, Check } from 'lucide-react';
import type { Compiler, MountedWidget, Manifest } from '@aprovan/patchwork-compiler';
import { createSingleFileProject } from '@aprovan/patchwork-compiler';
import { EditModal, type CompileFn } from './edit';
import { saveProject, getVFSConfig } from '../lib/vfs';

type SaveStatus = 'unsaved' | 'saving' | 'saved' | 'error';

interface CodePreviewProps {
  code: string;
  compiler: Compiler | null;
  /** Available service namespaces for widget calls */
  services?: string[];
  /** Optional file path from code block attributes (e.g., "components/calculator.tsx") */
  filePath?: string;
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

function useCodeCompiler(compiler: Compiler | null, code: string, enabled: boolean, services?: string[]) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef<MountedWidget | null>(null);

  useEffect(() => {
    if (!enabled || !compiler || !containerRef.current) return;

    let cancelled = false;

    async function compileAndMount() {
      if (!containerRef.current || !compiler) return;

      setLoading(true);
      setError(null);

      try {
        if (mountedRef.current) {
          compiler.unmount(mountedRef.current);
          mountedRef.current = null;
        }

        const widget = await compiler.compile(
          code,
          createManifest(services),
          { typescript: true }
        );

        if (cancelled) {
          return;
        }

        const mounted = await compiler.mount(widget, {
          target: containerRef.current,
          mode: 'embedded'
        });

        mountedRef.current = mounted;
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to render JSX');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    compileAndMount();

    return () => {
      cancelled = true;
      if (mountedRef.current && compiler) {
        compiler.unmount(mountedRef.current);
        mountedRef.current = null;
      }
    };
  }, [code, compiler, enabled, services]);

  return { containerRef, loading, error };
}

export function CodePreview({ code: originalCode, compiler, services, filePath }: CodePreviewProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const [currentCode, setCurrentCode] = useState(originalCode);
  const [editCount, setEditCount] = useState(0);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('unsaved');

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
      return parts[parts.length - 1] || 'main.tsx';
    }
    return 'main.tsx';
  }, [filePath]);

  // Manual save handler
  const handleSave = useCallback(async () => {
    setSaveStatus('saving');
    try {
      const projectId = await getProjectId();
      const entryFile = getEntryFile();
      const project = createSingleFileProject(currentCode, entryFile, projectId);
      await saveProject(project);
      setSaveStatus('saved');
    } catch (err) {
      console.warn('[VFS] Failed to save project:', err);
      setSaveStatus('error');
    }
  }, [currentCode, getProjectId, getEntryFile]);

  const { containerRef, loading, error } = useCodeCompiler(
    compiler,
    currentCode,
    showPreview && !isEditing,
    services
  );

  const compile: CompileFn = useCallback(
    async (code: string) => {
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
    [compiler, services]
  );

  const handleRevert = () => {
    setCurrentCode(originalCode);
    setEditCount(0);
  };

  const hasChanges = currentCode !== originalCode;

  return (
    <>
      <div className="my-3 border rounded-lg">
        <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 border-b rounded-t-lg">
          <Code className="h-4 w-4 text-muted-foreground" />
          {editCount > 0 && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <MessageSquare className="h-3 w-3" />
              {editCount} edit{editCount !== 1 ? 's' : ''}
            </span>
          )}
          {/* Save status indicator */}
            <button
              onClick={handleSave}
              disabled={saveStatus === 'saving'}
              className={`px-2 py-1 text-xs rounded flex items-center gap-1 ${
                saveStatus === 'saved' 
                  ? 'text-green-600' 
                  : saveStatus === 'error' 
                    ? 'text-destructive hover:bg-muted' 
                    : 'text-muted-foreground hover:bg-muted'
              }`}
              title={saveStatus === 'saved' ? 'Saved to disk' : saveStatus === 'saving' ? 'Saving...' : saveStatus === 'error' ? 'Save failed - click to retry' : 'Click to save'}
            >
              {saveStatus === 'saving' ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <span className="relative">
                  <Cloud className="h-3 w-3" />
                  {saveStatus === 'saved' && (
                    <Check className="h-2 w-2 absolute -bottom-0.5 -right-0.5 stroke-[3]" />
                  )}
                </span>
              )}
            </button>
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
              onClick={() => setIsEditing(true)}
              className="px-2 py-1 text-xs rounded flex items-center gap-1 hover:bg-muted"
              title="Edit component"
            >
              <Pencil className="h-3 w-3" />
            </button>
            <button
              onClick={() => setShowPreview(!showPreview)}
              className={`px-2 py-1 text-xs rounded flex items-center gap-1 ${showPreview ? 'bg-primary text-primary-foreground' : 'hover:bg-primary/20 text-primary'}`}
            >
              {showPreview ? <Eye className="h-3 w-3" /> : <Code className="h-3 w-3" />}
              {showPreview ? 'Preview' : 'Code'}
            </button>
          </div>
        </div>

        {showPreview ? (
          <div className="bg-white">
            {error ? (
              <div className="p-3 text-sm text-destructive flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            ) : loading ? (
              <div className="p-3 flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">Rendering preview...</span>
              </div>
            ) : !compiler ? (
              <div className="p-3 text-sm text-muted-foreground">
                Compiler not initialized
              </div>
            ) : null}
            <div ref={containerRef} />
          </div>
        ) : (
          <div className="p-3 bg-muted/30 overflow-auto max-h-96">
            <pre className="text-xs whitespace-pre-wrap break-words m-0">
              <code>{currentCode}</code>
            </pre>
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
        renderPreview={(code) => <ModalPreview code={code} compiler={compiler} services={services} />}
      />
    </>
  );
}

function ModalPreview({
  code,
  compiler,
  services,
}: {
  code: string;
  compiler: Compiler | null;
  services?: string[];
}) {
  const { containerRef, loading, error } = useCodeCompiler(compiler, code, true, services);

  return (
    <>
      {error && (
        <div className="text-sm text-destructive flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {loading && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Rendering preview...</span>
        </div>
      )}
      {!compiler && !loading && !error && (
        <div className="text-sm text-muted-foreground">Compiler not initialized</div>
      )}
      <div ref={containerRef} />
    </>
  );
}
