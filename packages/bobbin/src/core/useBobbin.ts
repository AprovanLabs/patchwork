import { useState, useCallback, useMemo, useEffect } from 'react';
import type {
  BobbinState,
  BobbinActions,
  BobbinProps,
  DesignTokens,
  Annotation,
} from '../types';
import { useElementSelection } from './useElementSelection';
import { useChangeTracker } from './useChangeTracker';
import { useClipboard } from './useClipboard';
import { serializeChangesToYAML } from './changeSerializer';
import { defaultTokens } from '../tokens';
import { getElementPath, getElementXPath } from '../utils/selectors';
import { applyStyleToElement, enableContentEditable } from '../utils/dom';

export function useBobbin(props: BobbinProps = {}) {
  const {
    tokens: customTokens,
    container,
    defaultActive = false,
    onChanges,
    onSelect,
    exclude = [],
  } = props;

  const [isActive, setIsActive] = useState(defaultActive);
  const [isPillExpanded, setIsPillExpanded] = useState(false);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [showMarginPadding, setShowMarginPadding] = useState(false);
  const [activePanel, setActivePanel] = useState<'style' | 'inspector' | null>(
    'style',
  );
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system');

  // Merge tokens
  const tokens = useMemo<DesignTokens>(
    () => ({
      ...defaultTokens,
      ...customTokens,
    }),
    [customTokens],
  );

  // Element selection
  const { hoveredElement, selectedElement, selectElement, clearSelection } =
    useElementSelection({
      container,
      exclude: [...exclude, '[data-bobbin]'],
      enabled: isActive,
    });

  // Change tracking
  const changeTracker = useChangeTracker();

  // Clipboard
  const clipboard = useClipboard();

  // Enable contenteditable on selection
  useEffect(() => {
    if (selectedElement) {
      enableContentEditable(selectedElement.element, true);
      return () => enableContentEditable(selectedElement.element, false);
    }
  }, [selectedElement]);

  // Notify on changes
  useEffect(() => {
    onChanges?.(changeTracker.changes);
  }, [changeTracker.changes, onChanges]);

  // Notify on selection
  useEffect(() => {
    onSelect?.(selectedElement);
  }, [selectedElement, onSelect]);

  // Theme management
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
      root.style.colorScheme = 'dark';
    } else if (theme === 'light') {
      root.classList.remove('dark');
      root.style.colorScheme = 'light';
    } else {
      // System preference
      const prefersDark = window.matchMedia(
        '(prefers-color-scheme: dark)',
      ).matches;
      root.classList.toggle('dark', prefersDark);
      root.style.colorScheme = prefersDark ? 'dark' : 'light';
    }
  }, [theme]);

  // Actions
  const activate = useCallback(() => setIsActive(true), []);
  const deactivate = useCallback(() => {
    setIsActive(false);
    clearSelection();
  }, [clearSelection]);

  const applyStyle = useCallback(
    (property: string, value: string) => {
      if (!selectedElement) return;

      const el = selectedElement.element;
      const originalValue = getComputedStyle(el).getPropertyValue(property);

      applyStyleToElement(el, property, value);
      changeTracker.recordStyleChange(
        selectedElement.path,
        selectedElement.xpath,
        selectedElement.tagName,
        property,
        value,
        originalValue,
      );
    },
    [selectedElement, changeTracker],
  );

  const deleteElement = useCallback(() => {
    if (!selectedElement) return;

    const el = selectedElement.element;
    const parent = el.parentElement;
    if (!parent) return;

    changeTracker.recordChange(
      'delete',
      selectedElement.path,
      selectedElement.xpath,
      selectedElement.tagName,
      el.outerHTML,
      null,
    );

    el.remove();
    clearSelection();
  }, [selectedElement, changeTracker, clearSelection]);

  const moveElement = useCallback(
    (targetParent: HTMLElement, index: number) => {
      if (!selectedElement) return;

      const el = selectedElement.element;
      const fromParent = el.parentElement;
      if (!fromParent) return;

      const fromIndex = Array.from(fromParent.children).indexOf(el);
      const fromPath = getElementPath(fromParent);
      const toPath = getElementPath(targetParent);

      if (index >= targetParent.children.length) {
        targetParent.appendChild(el);
      } else {
        const referenceNode = targetParent.children[index] ?? null;
        targetParent.insertBefore(el, referenceNode);
      }

      changeTracker.recordMoveChange(
        selectedElement.path,
        selectedElement.xpath,
        selectedElement.tagName,
        fromPath,
        fromIndex,
        toPath,
        index,
      );
    },
    [selectedElement, changeTracker],
  );

  const duplicateElement = useCallback(() => {
    if (!selectedElement) return;

    const el = selectedElement.element;
    const clone = el.cloneNode(true) as HTMLElement;
    const parent = el.parentElement;

    if (parent) {
      parent.insertBefore(clone, el.nextSibling);
    }

    changeTracker.recordChange(
      'duplicate',
      selectedElement.path,
      selectedElement.xpath,
      selectedElement.tagName,
      null,
      clone.outerHTML,
    );

    // Select the newly duplicated element
    selectElement(clone);
  }, [selectedElement, changeTracker, selectElement]);

  const insertElement = useCallback(
    (direction: 'before' | 'after' | 'child', content = '') => {
      if (!selectedElement) return;

      const el = selectedElement.element;
      const newEl = document.createElement('span');
      newEl.textContent = content || '\u200B'; // Zero-width space if empty
      newEl.contentEditable = 'true';

      if (direction === 'child') {
        el.appendChild(newEl);
      } else if (direction === 'before') {
        el.parentElement?.insertBefore(newEl, el);
      } else {
        el.parentElement?.insertBefore(newEl, el.nextSibling);
      }

      changeTracker.recordChange(
        'insert',
        getElementPath(newEl),
        getElementXPath(newEl),
        'span',
        null,
        newEl.outerHTML,
        { direction },
      );

      // Select the newly inserted element
      selectElement(newEl);
    },
    [selectedElement, changeTracker, selectElement],
  );

  const copyElement = useCallback(() => {
    if (!selectedElement) return;
    clipboard.copy(selectedElement);
  }, [selectedElement, clipboard]);

  const pasteElement = useCallback(
    (direction: 'before' | 'after' | 'child') => {
      if (!selectedElement || !clipboard.copied) return;

      const el = selectedElement.element;
      const clone = clipboard.copied.element.cloneNode(true) as HTMLElement;

      if (direction === 'child') {
        el.appendChild(clone);
      } else if (direction === 'before') {
        el.parentElement?.insertBefore(clone, el);
      } else {
        el.parentElement?.insertBefore(clone, el.nextSibling);
      }

      changeTracker.recordChange(
        'insert',
        getElementPath(clone),
        getElementXPath(clone),
        clone.tagName.toLowerCase(),
        null,
        clone.outerHTML,
        { source: 'paste', direction },
      );

      // Select the newly pasted element
      selectElement(clone);
    },
    [selectedElement, clipboard, changeTracker, selectElement],
  );

  const annotate = useCallback(
    (content: string) => {
      if (!selectedElement) return;

      setAnnotations((prev) => {
        // Check if annotation already exists for this element
        const existingIndex = prev.findIndex(
          (a) => a.elementPath === selectedElement.path,
        );

        if (existingIndex >= 0) {
          const existing = prev[existingIndex];
          if (!existing) return prev;

          // Update existing annotation
          if (!content.trim()) {
            // Remove annotation if content is empty
            return prev.filter((_, i) => i !== existingIndex);
          }
          const updated = [...prev];
          updated[existingIndex] = {
            id: existing.id,
            elementPath: existing.elementPath,
            elementXpath: existing.elementXpath,
            content,
            createdAt: Date.now(),
          };
          return updated;
        } else if (content.trim()) {
          // Add new annotation only if content is not empty
          const annotation: Annotation = {
            id: crypto.randomUUID(),
            elementPath: selectedElement.path,
            elementXpath: selectedElement.xpath,
            content,
            createdAt: Date.now(),
          };
          return [...prev, annotation];
        }
        return prev;
      });
    },
    [selectedElement],
  );

  const toggleMarginPadding = useCallback(() => {
    setShowMarginPadding((prev) => !prev);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      if (prev === 'light') return 'dark';
      if (prev === 'dark') return 'system';
      return 'light';
    });
  }, []);

  const undo = useCallback(() => {
    const lastChange = changeTracker.undo();
    if (!lastChange) return;

    // TODO: Implement actual undo logic based on change type
    console.log('Undoing:', lastChange);
  }, [changeTracker]);

  // Reset all style changes by reverting to original values
  const resetChanges = useCallback(() => {
    const originalStates = changeTracker.originalStates;

    // Revert all changes by applying original values
    for (const [path, properties] of originalStates.entries()) {
      // Find the element by path
      const el = document.querySelector(path) as HTMLElement;
      if (!el) continue;

      for (const [property, originalValue] of properties.entries()) {
        applyStyleToElement(el, property, originalValue);
      }
    }

    changeTracker.clearChanges();
  }, [changeTracker]);

  const exportChanges = useCallback(() => {
    return serializeChangesToYAML(
      changeTracker.deduplicatedChanges,
      annotations,
    );
  }, [changeTracker.deduplicatedChanges, annotations]);

  const state: BobbinState = {
    isActive,
    isPillExpanded,
    hoveredElement,
    selectedElement,
    changes: changeTracker.deduplicatedChanges,
    annotations,
    clipboard: clipboard.copied,
    showMarginPadding,
    activePanel,
    theme,
  };

  const actions: BobbinActions = {
    activate,
    deactivate,
    selectElement,
    clearSelection,
    applyStyle,
    deleteElement,
    moveElement,
    duplicateElement,
    insertElement,
    copyElement,
    pasteElement,
    annotate,
    toggleMarginPadding,
    toggleTheme,
    undo,
    exportChanges,
    getChanges: changeTracker.getChanges,
    resetChanges,
  };

  return {
    ...state,
    ...actions,
    tokens,
    setActivePanel,
    setIsPillExpanded,
  };
}
