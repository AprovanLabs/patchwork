import { createSingleFileProject } from "@aprovan/patchwork-compiler";
import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import type {
  EditHistoryEntry,
  EditSessionState,
} from "./types";
import type { VirtualProject } from "@aprovan/patchwork-compiler";

export interface UseProjectStateOptions {
  originalCode?: string;
  originalProject?: VirtualProject;
  initialActiveFile?: string;
}

function cloneProject(project: VirtualProject): VirtualProject {
  return {
    ...project,
    files: new Map(project.files),
  };
}

export function useProjectState(
  options: UseProjectStateOptions,
): Omit<EditSessionState, "isApplying" | "error" | "streamingNotes" | "pendingPrompt"> & {
  setProject: React.Dispatch<React.SetStateAction<VirtualProject>>;
  setActiveFile: React.Dispatch<React.SetStateAction<string>>;
  history: EditHistoryEntry[];
  setHistory: React.Dispatch<React.SetStateAction<EditHistoryEntry[]>>;
  revert: () => void;
  updateActiveFile: (content: string) => void;
  replaceFile: (path: string, content: string, encoding?: "utf8" | "base64") => void;
  currentCode: string;
} {
  const {
    originalCode,
    originalProject: providedProject,
    initialActiveFile,
  } = options;

  const originalProject = useMemo(
    () => providedProject ?? createSingleFileProject(originalCode ?? ""),
    [providedProject, originalCode],
  );

  const lastSyncedProjectRef = useRef<VirtualProject>(originalProject);

  const [project, setProject] = useState<VirtualProject>(originalProject);
  const [activeFile, setActiveFile] = useState(
    initialActiveFile && originalProject.files.has(initialActiveFile)
      ? initialActiveFile
      : originalProject.entry,
  );
  const [history, setHistory] = useState<EditHistoryEntry[]>([]);

  useEffect(() => {
    if (originalProject !== lastSyncedProjectRef.current) {
      lastSyncedProjectRef.current = originalProject;
      setProject(originalProject);
      setActiveFile(
        initialActiveFile && originalProject.files.has(initialActiveFile)
          ? initialActiveFile
          : originalProject.entry,
      );
      setHistory([]);
    }
  }, [originalProject, initialActiveFile]);

  const currentCode = useMemo(
    () => project.files.get(activeFile)?.content ?? "",
    [project, activeFile],
  );

  const revert = useCallback(() => {
    setProject(originalProject);
    setActiveFile(originalProject.entry);
    setHistory([]);
  }, [originalProject]);

  const updateActiveFile = useCallback(
    (content: string) => {
      setProject((prev: VirtualProject) => {
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

  const replaceFile = useCallback(
    (path: string, content: string, encoding: "utf8" | "base64" = "utf8") => {
      setProject((prev: VirtualProject) => {
        const updated = cloneProject(prev);
        const file = updated.files.get(path);
        if (file) {
          updated.files.set(path, { ...file, content, encoding });
        } else {
          updated.files.set(path, { path, content, encoding });
        }
        return updated;
      });
    },
    [],
  );

  return {
    project,
    originalProject,
    activeFile,
    setActiveFile,
    history,
    setHistory,
    setProject,
    revert,
    updateActiveFile,
    replaceFile,
    currentCode,
  };
}
