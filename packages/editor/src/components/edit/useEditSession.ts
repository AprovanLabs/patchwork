import { useState, useCallback } from "react";
import { sendEditRequest, type EditTransport } from "./api";
import { useProjectState } from "./useProjectState";
import type {
  EditHistoryEntry,
  EditSessionState,
  EditSessionActions,
  CompileFn,
} from "./types";
import type { VirtualProject } from "@aprovan/patchwork-compiler";

export interface UseEditSessionOptions {
  originalCode?: string;
  originalProject?: VirtualProject;
  initialActiveFile?: string;
  compile?: CompileFn;
  apiEndpoint?: string;
  /** Run edits through a host LLM instead of POSTing to `apiEndpoint`. */
  editTransport?: EditTransport;
}

export function useEditSession(
  options: UseEditSessionOptions,
): EditSessionState & EditSessionActions {
  const {
    compile,
    apiEndpoint,
    editTransport,
  } = options;

  const state = useProjectState(options);
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
          transport: editTransport,
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
    [compile, apiEndpoint, editTransport],
  );

  const submitEdit = useCallback(
    async (prompt: string) => {
      if (!prompt.trim() || isApplying) return;

      setIsApplying(true);
      setError(null);
      setStreamingNotes([]);
      setPendingPrompt(prompt);

      try {
        const result = await performEdit(state.currentCode, prompt);
        state.setProject((prev: VirtualProject) => {
          const updated = { ...prev, files: new Map(prev.files) };
          const file = updated.files.get(state.activeFile);
          if (file) {
            updated.files.set(state.activeFile, { ...file, content: result.newCode });
          }
          return updated;
        });
        state.setHistory((prev: EditHistoryEntry[]) => [...prev, ...result.entries]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Edit failed");
      } finally {
        setIsApplying(false);
        setStreamingNotes([]);
        setPendingPrompt(null);
      }
    },
    [state.currentCode, state.activeFile, state.setProject, state.setHistory, isApplying, performEdit],
  );

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    project: state.project,
    originalProject: state.originalProject,
    activeFile: state.activeFile,
    history: state.history,
    isApplying,
    error,
    streamingNotes,
    pendingPrompt,
    submitEdit,
    revert: state.revert,
    updateActiveFile: state.updateActiveFile,
    setActiveFile: state.setActiveFile,
    clearError,
    replaceFile: state.replaceFile,
  };
}
