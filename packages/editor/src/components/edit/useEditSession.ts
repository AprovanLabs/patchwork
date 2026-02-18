import { useState, useCallback, useMemo } from 'react';
import type { VirtualProject } from '@aprovan/patchwork-compiler';
import { createSingleFileProject } from '@aprovan/patchwork-compiler';
import { sendEditRequest } from './api';
import type {
  EditHistoryEntry,
  EditSessionState,
  EditSessionActions,
  CompileFn,
} from './types';

export interface UseEditSessionOptions {
  originalCode: string;
  compile?: CompileFn;
  apiEndpoint?: string;
}

function cloneProject(project: VirtualProject): VirtualProject {
  return {
    ...project,
    files: new Map(project.files),
  };
}

export function useEditSession(
  options: UseEditSessionOptions,
): EditSessionState & EditSessionActions {
  const { originalCode, compile, apiEndpoint } = options;

  const originalProject = useMemo(
    () => createSingleFileProject(originalCode),
    [originalCode],
  );

  const [project, setProject] = useState<VirtualProject>(originalProject);
  const [activeFile, setActiveFile] = useState(originalProject.entry);
  const [history, setHistory] = useState<EditHistoryEntry[]>([]);
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streamingNotes, setStreamingNotes] = useState<string[]>([]);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);

  const performEdit = useCallback(
    async (
      currentCode: string,
      prompt: string,
      isRetry = false,
    ): Promise<{ newCode: string; entries: EditHistoryEntry[] }> => {
      const entries: EditHistoryEntry[] = [];

      const response = await sendEditRequest(
        { code: currentCode, prompt },
        {
          endpoint: apiEndpoint,
          onProgress: (note) => setStreamingNotes((prev) => [...prev, note]),
        },
      );

      entries.push({
        prompt: isRetry ? `Fix: ${prompt}` : prompt,
        summary: response.summary,
        isRetry,
      });

      if (compile) {
        const compileResult = await compile(response.newCode);
        if (!compileResult.success && compileResult.error) {
          setStreamingNotes([]);
          const errorPrompt = `Compilation error: ${compileResult.error}\n\nPlease fix this error.`;
          const retryResult = await performEdit(
            response.newCode,
            errorPrompt,
            true,
          );
          return {
            newCode: retryResult.newCode,
            entries: [...entries, ...retryResult.entries],
          };
        }
      }

      return { newCode: response.newCode, entries };
    },
    [compile, apiEndpoint],
  );

  const currentCode = useMemo(
    () => project.files.get(activeFile)?.content ?? '',
    [project, activeFile],
  );

  const submitEdit = useCallback(
    async (prompt: string) => {
      if (!prompt.trim() || isApplying) return;

      setIsApplying(true);
      setError(null);
      setStreamingNotes([]);
      setPendingPrompt(prompt);

      try {
        const result = await performEdit(currentCode, prompt);
        setProject((prev) => {
          const updated = cloneProject(prev);
          const file = updated.files.get(activeFile);
          if (file) {
            updated.files.set(activeFile, { ...file, content: result.newCode });
          }
          return updated;
        });
        setHistory((prev) => [...prev, ...result.entries]);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Edit failed');
      } finally {
        setIsApplying(false);
        setStreamingNotes([]);
        setPendingPrompt(null);
      }
    },
    [currentCode, activeFile, isApplying, performEdit],
  );

  const revert = useCallback(() => {
    setProject(originalProject);
    setActiveFile(originalProject.entry);
    setHistory([]);
    setError(null);
    setStreamingNotes([]);
  }, [originalProject]);

  const updateActiveFile = useCallback(
    (content: string) => {
      setProject((prev) => {
        const updated = cloneProject(prev);
        const file = updated.files.get(activeFile);
        if (file) {
          updated.files.set(activeFile, { ...file, content });
        }
        return updated;
      });
    },
    [activeFile],
  );

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    project,
    originalProject,
    activeFile,
    history,
    isApplying,
    error,
    streamingNotes,
    pendingPrompt,
    submitEdit,
    revert,
    updateActiveFile,
    setActiveFile,
    clearError,
  };
}
