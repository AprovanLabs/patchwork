export { CodeBlockExtension } from "./components/CodeBlockExtension";
export { CodePreview } from "./components/CodePreview";
export { WidgetPreview } from "./components/WidgetPreview";
export { MarkdownEditor } from "./components/MarkdownEditor";
export { MarkdownPreview } from "./components/MarkdownPreview";
export { ServicesInspector, type ServiceInfo } from "./components/ServicesInspector";

// Edit components — intentional public API boundary (see components/edit/index.ts)
export {
  EditModal,
  EditHistory,
  FileTree,
  SaveConfirmDialog,
  CodeBlockView,
  MediaPreview,
  useEditSession,
  useProjectState,
  sendEditRequest,
  type EditModalProps,
  type UseEditSessionOptions,
  type UseProjectStateOptions,
  type EditHistoryEntry,
  type EditSessionState,
  type EditSessionActions,
  type EditRequest,
  type EditResponse,
  type CompileResult,
  type CompileFn,
  type EditApiOptions,
  type FileTreeProps,
  type SaveConfirmDialogProps,
  type CodeBlockViewProps,
  type MediaPreviewProps,
  type FileCategory,
  type FileTypeInfo,
  type FileEncoding,
  getActiveContent,
  getFiles,
  getFileType,
  isCompilable,
  isMediaFile,
  isTextFile,
  isMarkdownFile,
  isPreviewable,
  isImageFile,
  isVideoFile,
  getLanguageFromExt,
  getMimeType,
} from "./components/edit";

export {
  extractCodeBlocks,
  findFirstCodeBlock,
  hasCodeBlock,
  getCodeBlockLanguages,
  extractProject,
  type TextPart,
  type CodePart,
  type ParsedPart,
  type ExtractOptions,
} from "./lib/code-extractor";

export {
  parseCodeBlockAttributes,
  parseCodeBlocks,
  findDiffMarkers,
  sanitizeDiffMarkers,
  parseEditResponse,
  parseDiffs,
  applyDiffs,
  hasDiffBlocks,
  extractTextWithoutDiffs,
  extractSummary,
  type CodeBlockAttributes,
  type CodeBlock,
  type DiffBlock,
  type ParsedEditResponse,
} from "./lib/diff";

export {
  getVFSConfig,
  getVFSStore,
  saveProject,
  loadProject,
  listProjects,
  saveFile,
  isVFSAvailable,
} from "./lib/vfs";

export { cn } from "./lib/utils";
