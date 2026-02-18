import { useLayoutEffect, useState } from 'react';
import type { SelectedElement } from '../../types';

interface SelectionOverlayProps {
  hoveredElement: SelectedElement | null;
  selectedElement: SelectedElement | null;
  offset?: number;
  zIndex?: number;
}

export function SelectionOverlay({
  hoveredElement,
  selectedElement,
  offset = 4,
  zIndex = 9998,
}: SelectionOverlayProps) {
  const [hoverRect, setHoverRect] = useState<DOMRect | null>(null);
  const [selectRect, setSelectRect] = useState<DOMRect | null>(null);

  // Animate hover box
  useLayoutEffect(() => {
    if (!hoveredElement || hoveredElement === selectedElement) {
      setHoverRect(null);
      return;
    }
    setHoverRect(hoveredElement.rect);
  }, [hoveredElement, selectedElement]);

  // Animate selection box
  useLayoutEffect(() => {
    if (!selectedElement) {
      setSelectRect(null);
      return;
    }
    setSelectRect(selectedElement.rect);
  }, [selectedElement]);

  // ShadCN-style: subtle dark gray for hover, black for selection
  const createBoxStyle = (rect: DOMRect | null, isSelected: boolean): React.CSSProperties => {
    if (!rect) return { opacity: 0, pointerEvents: 'none' };
    
    return {
      position: 'fixed',
      top: rect.top - offset,
      left: rect.left - offset,
      width: rect.width + offset * 2,
      height: rect.height + offset * 2,
      border: isSelected ? '1.5px solid #18181b' : '1.5px dashed #71717a',
      borderRadius: '3px',
      pointerEvents: 'none',
      zIndex,
      transition: 'all 0.12s cubic-bezier(0.4, 0, 0.2, 1)',
      opacity: 1,
      boxShadow: isSelected ? '0 0 0 1px rgba(24, 24, 27, 0.1)' : 'none',
    };
  };

  return (
    <>
      {/* Hover overlay */}
      <div
        data-bobbin="hover-overlay"
        style={createBoxStyle(hoverRect, false)}
      />

      {/* Selection overlay */}
      <div
        data-bobbin="select-overlay"
        style={createBoxStyle(selectRect, true)}
      />
    </>
  );
}
