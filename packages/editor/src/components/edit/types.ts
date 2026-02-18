import type { VirtualProject, VirtualFile } from '@aprovan/patchwork-compiler';

export interface EditHistoryEntry {
  prompt: string;
  summary: string;
  isRetry?: boolean;
}

export interface EditSessionState {
  project: VirtualProject;
  originalProject: VirtualProject;
  activeFile: string;
  history: EditHistoryEntry[];
  isApplying: boolean;
  error: string | null;
  streamingNotes: string[];
  pendingPrompt: string | null;
}

export interface EditSessionActions {
  submitEdit: (prompt: string) => Promise<void>;
  revert: () => void;
  updateActiveFile: (content: string) => void;
  setActiveFile: (path: string) => void;
  clearError: () => void;
}

// Convenience getters
export function getActiveContent(state: EditSessionState): string {
  return state.project.files.get(state.activeFile)?.content ?? '';
}

export function getFiles(project: VirtualProject): VirtualFile[] {
  return Array.from(project.files.values());
}

export interface EditRequest {
  code: string;
  prompt: string;
}

export interface EditResponse {
  newCode: string;
  summary: string;
  progressNotes: string[];
}

export interface CompileResult {
  success: boolean;
  error?: string;
}

export type CompileFn = (code: string) => Promise<CompileResult>;
