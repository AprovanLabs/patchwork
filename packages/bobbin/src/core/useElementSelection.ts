import { useState, useCallback, useEffect, useRef } from 'react';
import {
  containsAcrossFrames,
  frameDocuments,
  viewportRect,
} from '../utils/dom';
import { getElementPath, getElementXPath } from '../utils/selectors';
import type { SelectedElement } from '../types';

export interface UseElementSelectionOptions {
  container?: HTMLElement | null;
  exclude?: string[];
  enabled?: boolean;
}

const sameDocuments = (a: Document[], b: Document[]) =>
  a.length === b.length && a.every((doc, i) => doc === b[i]);

export function useElementSelection(options: UseElementSelectionOptions) {
  const { container, exclude = [], enabled = true } = options;

  const [hoveredElement, setHoveredElement] = useState<SelectedElement | null>(
    null,
  );
  const [selectedElement, setSelectedElement] =
    useState<SelectedElement | null>(null);
  // Widget previews render inside same-origin iframes, and events raised in a
  // frame never reach the host document — selection has to listen in each one.
  const [documents, setDocuments] = useState<Document[]>(() => [document]);
  const lastRectRef = useRef<DOMRect | null>(null);

  const isExcluded = useCallback(
    (el: HTMLElement): boolean => {
      // Exclude bobbin elements themselves
      if (el.closest('[data-bobbin]')) return true;
      // Exclude user-specified selectors
      return exclude.some(
        (selector) => el.matches(selector) || el.closest(selector),
      );
    },
    [exclude],
  );

  const createSelectedElement = useCallback(
    (el: HTMLElement): SelectedElement => {
      return {
        element: el,
        rect: viewportRect(el),
        path: getElementPath(el),
        xpath: getElementXPath(el),
        tagName: el.tagName.toLowerCase(),
        id: el.id || undefined,
        classList: Array.from(el.classList),
      };
    },
    [],
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!enabled) return;

      // Coordinates are frame-local, so hit-test in the frame that fired.
      const doc = (e.view ?? window).document;
      const target = doc.elementFromPoint(
        e.clientX,
        e.clientY,
      ) as HTMLElement | null;
      if (!target || isExcluded(target)) {
        setHoveredElement(null);
        return;
      }

      // Check if within container bounds
      if (container && !containsAcrossFrames(container, target)) {
        setHoveredElement(null);
        return;
      }

      setHoveredElement(createSelectedElement(target));
    },
    [enabled, container, isExcluded, createSelectedElement],
  );

  const handleClick = useCallback(
    (e: MouseEvent) => {
      if (!enabled) return;

      // Don't intercept clicks on bobbin UI elements
      const target = e.target as HTMLElement;
      if (target.closest('[data-bobbin]')) {
        return;
      }

      if (!hoveredElement) return;

      e.preventDefault();
      e.stopPropagation();

      setSelectedElement(hoveredElement);
      lastRectRef.current = hoveredElement.rect;
    },
    [enabled, hoveredElement],
  );

  const clearSelection = useCallback(() => {
    setSelectedElement(null);
    setHoveredElement(null);
  }, []);

  const selectElement = useCallback(
    (el: HTMLElement | null) => {
      if (!el) {
        clearSelection();
        return;
      }
      setSelectedElement(createSelectedElement(el));
    },
    [createSelectedElement, clearSelection],
  );

  // Track which documents live under the container. A widget frame is replaced
  // on every recompile, and its document only exists once the frame has
  // loaded, so re-scan on both DOM mutations and frame loads.
  useEffect(() => {
    if (!enabled) return;
    const root = container ?? document.body;

    const scan = () =>
      setDocuments((prev) => {
        const next = frameDocuments(root);
        return sameDocuments(prev, next) ? prev : next;
      });

    scan();
    const observer = new MutationObserver(scan);
    observer.observe(root, { childList: true, subtree: true });
    // `load` doesn't bubble, but the capture phase still reaches the window.
    window.addEventListener('load', scan, true);

    return () => {
      observer.disconnect();
      window.removeEventListener('load', scan, true);
      setDocuments([document]);
    };
  }, [enabled, container]);

  useEffect(() => {
    if (!enabled) return;

    for (const doc of documents) {
      doc.addEventListener('mousemove', handleMouseMove, { passive: true });
      doc.addEventListener('click', handleClick, { capture: true });
    }

    return () => {
      for (const doc of documents) {
        doc.removeEventListener('mousemove', handleMouseMove);
        doc.removeEventListener('click', handleClick, { capture: true });
      }
    };
  }, [enabled, documents, handleMouseMove, handleClick]);

  // Update rect on scroll/resize — capture so nested scrollers (the preview
  // surface, the widget frame) are picked up too.
  useEffect(() => {
    if (!selectedElement) return;

    const updateRect = () => {
      setSelectedElement((prev) =>
        prev ? { ...prev, rect: viewportRect(prev.element) } : null,
      );
    };

    const views = new Set<Window>([
      window,
      selectedElement.element.ownerDocument.defaultView ?? window,
    ]);
    for (const view of views) {
      view.addEventListener('scroll', updateRect, {
        passive: true,
        capture: true,
      });
      view.addEventListener('resize', updateRect, { passive: true });
    }

    return () => {
      for (const view of views) {
        view.removeEventListener('scroll', updateRect, { capture: true });
        view.removeEventListener('resize', updateRect);
      }
    };
  }, [selectedElement?.element]);

  return {
    hoveredElement,
    selectedElement,
    selectElement,
    clearSelection,
    documents,
    lastRect: lastRectRef.current,
  };
}
