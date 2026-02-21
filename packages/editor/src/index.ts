// Components
export {
  CodeBlockExtension,
  CodePreview,
  MarkdownEditor,
  ServicesInspector,
  type ServiceInfo,
} from './components';

// Edit components
export {
  EditModal,
  EditHistory,
  FileTree,
  SaveConfirmDialog,
  CodeBlockView,
  MediaPreview,
  useEditSession,
  sendEditRequest,
  type EditModalProps,
  type UseEditSessionOptions,
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
  isImageFile,
  isVideoFile,
  getLanguageFromExt,
  getMimeType,
} from './components/edit';

// Lib utilities
export {
  // Code extractor
  extractCodeBlocks,
  findFirstCodeBlock,
  hasCodeBlock,
  getCodeBlockLanguages,
  extractProject,
  type TextPart,
  type CodePart,
  type ParsedPart,
  type ExtractOptions,
  
  // Diff utilities
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
  
  // VFS utilities
  getVFSConfig,
  getVFSStore,
  saveProject,
  loadProject,
  listProjects,
  saveFile,
  isVFSAvailable,
  
  // General utilities
  cn,
} from './lib';
