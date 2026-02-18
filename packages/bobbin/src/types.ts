// === Element Selection ===
export interface SelectedElement {
  element: HTMLElement;
  rect: DOMRect;
  path: string; // CSS selector path
  xpath: string; // XPath selector
  tagName: string;
  id?: string;
  classList: string[];
}

// === Change Tracking ===
export type ChangeType =
  | 'style' // CSS property change
  | 'text' // Text content change
  | 'delete' // Element removed
  | 'move' // Element repositioned
  | 'duplicate' // Element duplicated
  | 'insert' // New element inserted
  | 'attribute'; // Attribute modified

export interface Change {
  id: string;
  type: ChangeType;
  timestamp: number;
  target: {
    path: string; // CSS selector path to element
    xpath: string; // XPath selector to element
    tagName: string;
  };
  before: unknown;
  after: unknown;
  metadata?: Record<string, unknown>;
}

export interface StyleChange extends Change {
  type: 'style';
  before: { property: string; value: string };
  after: { property: string; value: string };
}

export interface TextChange extends Change {
  type: 'text';
  before: string;
  after: string;
}

export interface MoveChange extends Change {
  type: 'move';
  before: { parent: string; index: number };
  after: { parent: string; index: number };
}

// === Annotations ===
export interface Annotation {
  id: string;
  elementPath: string; // CSS selector
  elementXpath: string; // XPath selector
  content: string;
  createdAt: number;
}

// === Design Tokens ===
export interface DesignTokens {
  colors: Record<string, Record<string, string>>;
  spacing: Record<string, string>;
  fontSize: Record<string, string>;
  fontWeight: Record<string, string>;
  fontFamily: Record<string, string>;
  borderRadius: Record<string, string>;
  borderWidth: Record<string, string>;
  boxShadow: Record<string, string>;
  lineHeight: Record<string, string>;
  letterSpacing: Record<string, string>;
}

// === Bobbin State ===
export interface BobbinState {
  isActive: boolean;
  isPillExpanded: boolean;
  hoveredElement: SelectedElement | null;
  selectedElement: SelectedElement | null;
  changes: Change[];
  annotations: Annotation[];
  clipboard: SelectedElement | null;
  showMarginPadding: boolean;
  activePanel: 'style' | 'inspector' | null;
  theme: 'light' | 'dark' | 'system';
}

export interface BobbinActions {
  activate: () => void;
  deactivate: () => void;
  selectElement: (el: HTMLElement | null) => void;
  clearSelection: () => void;
  applyStyle: (property: string, value: string) => void;
  deleteElement: () => void;
  moveElement: (targetParent: HTMLElement, index: number) => void;
  duplicateElement: () => void;
  insertElement: (
    direction: 'before' | 'after' | 'child',
    content?: string,
  ) => void;
  copyElement: () => void;
  pasteElement: (direction: 'before' | 'after' | 'child') => void;
  annotate: (content: string) => void;
  toggleMarginPadding: () => void;
  toggleTheme: () => void;
  undo: () => void;
  exportChanges: () => string; // Returns YAML
  getChanges: () => Change[];
  resetChanges: () => void; // Reset all style changes
}

// === YAML Export Format ===
export interface BobbinChangeset {
  version: '1.0';
  timestamp: string;
  changeCount: number;
  changes: Array<{
    type: ChangeType;
    target: string; // CSS selector
    xpath: string; // XPath selector
    property?: string;
    before?: string;
    after?: string;
    note?: string;
  }>;
  annotations: Array<{
    type: 'annotation';
    target: string;
    xpath: string;
    note: string;
  }>;
}

// === Component Props ===
export interface BobbinProps {
  /** Custom design tokens to merge with defaults */
  tokens?: Partial<DesignTokens>;
  /** Container to scope element selection (default: document.body) */
  container?: HTMLElement | null;
  /** Container for pill positioning (if different from container) */
  pillContainer?: HTMLElement | null;
  /** Initial active state */
  defaultActive?: boolean;
  /** Callback when changes occur */
  onChanges?: (changes: Change[]) => void;
  /** Callback when selection changes */
  onSelect?: (element: SelectedElement | null) => void;
  /** Custom pill position offset from bottom-right of container */
  position?: { bottom: number; right: number };
  /** Z-index for overlay elements */
  zIndex?: number;
  /** Elements to exclude from selection (CSS selectors) */
  exclude?: string[];
}
