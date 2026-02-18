import { useState, useCallback, useEffect, useRef } from 'react';
import type { SelectedElement } from '../types';
import { getElementPath, getElementXPath } from '../utils/selectors';

export interface UseElementSelectionOptions {
  container?: HTMLElement | null;
  exclude?: string[];
  enabled?: boolean;
}

export function useElementSelection(options: UseElementSelectionOptions) {
  const { container, exclude = [], enabled = true } = options;

  const [hoveredElement, setHoveredElement] = useState<SelectedElement | null>(
    null,
  );
  const [selectedElement, setSelectedElement] =
    useState<SelectedElement | null>(null);
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
        rect: el.getBoundingClientRect(),
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

      const target = document.elementFromPoint(
        e.clientX,
        e.clientY,
      ) as HTMLElement | null;
      if (!target || isExcluded(target)) {
        setHoveredElement(null);
        return;
      }

      // Check if within container bounds
      if (container && !container.contains(target)) {
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

  useEffect(() => {
    if (!enabled) return;

    document.addEventListener('mousemove', handleMouseMove, { passive: true });
    document.addEventListener('click', handleClick, { capture: true });

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('click', handleClick, { capture: true });
    };
  }, [enabled, handleMouseMove, handleClick]);

  // Update rect on scroll/resize
  useEffect(() => {
    if (!selectedElement) return;

    const updateRect = () => {
      const newRect = selectedElement.element.getBoundingClientRect();
      setSelectedElement((prev) => (prev ? { ...prev, rect: newRect } : null));
    };

    window.addEventListener('scroll', updateRect, { passive: true });
    window.addEventListener('resize', updateRect, { passive: true });

    return () => {
      window.removeEventListener('scroll', updateRect);
      window.removeEventListener('resize', updateRect);
    };
  }, [selectedElement?.element]);

  return {
    hoveredElement,
    selectedElement,
    selectElement,
    clearSelection,
    lastRect: lastRectRef.current,
  };
}
