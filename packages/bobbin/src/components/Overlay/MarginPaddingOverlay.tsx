import type { SelectedElement } from '../../types';

interface MarginPaddingOverlayProps {
  selectedElement: SelectedElement;
  zIndex?: number;
}

export function MarginPaddingOverlay({
  selectedElement,
  zIndex = 9997,
}: MarginPaddingOverlayProps) {
  const { element, rect } = selectedElement;
  const computed = window.getComputedStyle(element);

  const margin = {
    top: parseFloat(computed.marginTop) || 0,
    right: parseFloat(computed.marginRight) || 0,
    bottom: parseFloat(computed.marginBottom) || 0,
    left: parseFloat(computed.marginLeft) || 0,
  };

  const padding = {
    top: parseFloat(computed.paddingTop) || 0,
    right: parseFloat(computed.paddingRight) || 0,
    bottom: parseFloat(computed.paddingBottom) || 0,
    left: parseFloat(computed.paddingLeft) || 0,
  };

  // Get gap information
  const gap = parseFloat(computed.gap) || 0;
  const rowGap = parseFloat(computed.rowGap) || gap;
  const columnGap = parseFloat(computed.columnGap) || gap;
  const display = computed.display;
  const flexDirection = computed.flexDirection;
  const isFlexOrGrid = display.includes('flex') || display.includes('grid');
  const isColumn = flexDirection === 'column' || flexDirection === 'column-reverse';

  // Margin color: orange tint
  const marginColor = 'rgba(251, 146, 60, 0.3)';
  // Padding color: green tint
  const paddingColor = 'rgba(74, 222, 128, 0.3)';
  // Gap color: purple tint
  const gapColor = 'rgba(168, 85, 247, 0.35)';

  // Get visible children and their rects
  const getGapOverlays = () => {
    if (!isFlexOrGrid || (rowGap === 0 && columnGap === 0)) return [];
    
    const children = Array.from(element.children).filter(
      child => child instanceof HTMLElement && 
               getComputedStyle(child).display !== 'none' &&
               getComputedStyle(child).visibility !== 'hidden'
    ) as HTMLElement[];
    
    if (children.length < 2) return [];
    
    const overlays: Array<{ top: number; left: number; width: number; height: number }> = [];
    
    for (let i = 0; i < children.length - 1; i++) {
      const currentChild = children[i];
      const nextChild = children[i + 1];
      if (!currentChild || !nextChild) continue;
      
      const currentRect = currentChild.getBoundingClientRect();
      const nextRect = nextChild.getBoundingClientRect();
      
      if (isColumn || display.includes('grid')) {
        // For column flex or grid, show row gaps (vertical gaps between rows)
        if (rowGap > 0 && nextRect.top > currentRect.bottom) {
          const gapTop = currentRect.bottom;
          const gapHeight = Math.min(rowGap, nextRect.top - currentRect.bottom);
          if (gapHeight > 0) {
            overlays.push({
              top: gapTop,
              left: rect.left + padding.left,
              width: rect.width - padding.left - padding.right,
              height: gapHeight,
            });
          }
        }
      }
      
      if (!isColumn || display.includes('grid')) {
        // For row flex or grid, show column gaps (horizontal gaps between columns)
        if (columnGap > 0 && nextRect.left > currentRect.right) {
          const gapLeft = currentRect.right;
          const gapWidth = Math.min(columnGap, nextRect.left - currentRect.right);
          if (gapWidth > 0) {
            overlays.push({
              top: rect.top + padding.top,
              left: gapLeft,
              width: gapWidth,
              height: rect.height - padding.top - padding.bottom,
            });
          }
        }
      }
    }
    
    return overlays;
  };

  const gapOverlays = getGapOverlays();

  return (
    <div data-bobbin="margin-padding-overlay" style={{ position: 'fixed', top: 0, left: 0, zIndex, pointerEvents: 'none' }}>
      {/* Top margin */}
      {margin.top > 0 && (
        <div
          style={{
            position: 'fixed',
            top: rect.top - margin.top,
            left: rect.left,
            width: rect.width,
            height: margin.top,
            backgroundColor: marginColor,
          }}
        />
      )}
      {/* Bottom margin */}
      {margin.bottom > 0 && (
        <div
          style={{
            position: 'fixed',
            top: rect.bottom,
            left: rect.left,
            width: rect.width,
            height: margin.bottom,
            backgroundColor: marginColor,
          }}
        />
      )}
      {/* Left margin */}
      {margin.left > 0 && (
        <div
          style={{
            position: 'fixed',
            top: rect.top,
            left: rect.left - margin.left,
            width: margin.left,
            height: rect.height,
            backgroundColor: marginColor,
          }}
        />
      )}
      {/* Right margin */}
      {margin.right > 0 && (
        <div
          style={{
            position: 'fixed',
            top: rect.top,
            left: rect.right,
            width: margin.right,
            height: rect.height,
            backgroundColor: marginColor,
          }}
        />
      )}

      {/* Top padding */}
      {padding.top > 0 && (
        <div
          style={{
            position: 'fixed',
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: padding.top,
            backgroundColor: paddingColor,
          }}
        />
      )}
      {/* Bottom padding */}
      {padding.bottom > 0 && (
        <div
          style={{
            position: 'fixed',
            top: rect.bottom - padding.bottom,
            left: rect.left,
            width: rect.width,
            height: padding.bottom,
            backgroundColor: paddingColor,
          }}
        />
      )}
      {/* Left padding */}
      {padding.left > 0 && (
        <div
          style={{
            position: 'fixed',
            top: rect.top + padding.top,
            left: rect.left,
            width: padding.left,
            height: rect.height - padding.top - padding.bottom,
            backgroundColor: paddingColor,
          }}
        />
      )}
      {/* Right padding */}
      {padding.right > 0 && (
        <div
          style={{
            position: 'fixed',
            top: rect.top + padding.top,
            left: rect.right - padding.right,
            width: padding.right,
            height: rect.height - padding.top - padding.bottom,
            backgroundColor: paddingColor,
          }}
        />
      )}

      {/* Gap overlays */}
      {gapOverlays.map((overlay, index) => (
        <div
          key={`gap-${index}`}
          style={{
            position: 'fixed',
            top: overlay.top,
            left: overlay.left,
            width: overlay.width,
            height: overlay.height,
            backgroundColor: gapColor,
          }}
        />
      ))}
    </div>
  );
}
