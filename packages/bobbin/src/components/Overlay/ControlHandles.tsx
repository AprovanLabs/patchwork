import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import type { SelectedElement, BobbinActions } from '../../types';

interface ControlHandlesProps {
  selectedElement: SelectedElement;
  actions: BobbinActions;
  clipboard: SelectedElement | null;
  zIndex?: number;
}

type HandlePosition = 'top' | 'bottom' | 'left' | 'right';

// Determine layout direction based on parent's flex/grid direction
function getLayoutDirection(element: HTMLElement): 'horizontal' | 'vertical' | 'unknown' {
  const parent = element.parentElement;
  if (!parent) return 'unknown';
  
  const style = getComputedStyle(parent);
  const display = style.display;
  const flexDirection = style.flexDirection;
  
  if (display.includes('flex')) {
    if (flexDirection === 'column' || flexDirection === 'column-reverse') {
      return 'vertical';
    }
    return 'horizontal';
  }
  
  if (display.includes('grid')) {
    return 'horizontal';
  }
  
  return 'vertical';
}

// Thresholds
const MIN_WIDTH_FOR_CORNER_TOOLBAR = 60; // Show corner toolbar if wider than this
const MIN_SIZE_FOR_EDGE_ICONS = 70; // Minimum size (height for left/right, width for top/bottom) to show all edge icons
const CORNER_HANDLE_SIZE = 18;
const HOVER_ZONE_SIZE = 28;

export function ControlHandles({
  selectedElement,
  actions,
  clipboard,
  zIndex = 9999,
}: ControlHandlesProps) {
  const [hoveredEdge, setHoveredEdge] = useState<HandlePosition | null>(null);
  const [expandedEdge, setExpandedEdge] = useState<HandlePosition | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dropTarget, setDropTarget] = useState<HTMLElement | null>(null);
  const [cornerToolbarExpanded, setCornerToolbarExpanded] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const { rect } = selectedElement;

  const layoutDirection = useMemo(
    () => getLayoutDirection(selectedElement.element),
    [selectedElement.element]
  );

  // Check if corner toolbar should collapse
  const isNarrowElement = rect.width < MIN_WIDTH_FOR_CORNER_TOOLBAR;
  
  // Check if edge zones need collapsing (based on element dimension perpendicular to edge)
  const isShortForVerticalEdge = rect.height < MIN_SIZE_FOR_EDGE_ICONS; // for left/right edges
  const isShortForHorizontalEdge = rect.width < MIN_SIZE_FOR_EDGE_ICONS; // for top/bottom edges

  // Reset states when element changes
  useEffect(() => {
    setCornerToolbarExpanded(false);
    setExpandedEdge(null);
    setHoveredEdge(null);
  }, [selectedElement.path]);

  // Icons (simplified SVG) - all monochrome, smaller size
  const TrashIcon = () => (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
    </svg>
  );

  const CopyIcon = () => (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
    </svg>
  );

  const MoveIcon = () => (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="5 9 2 12 5 15" />
      <polyline points="9 5 12 2 15 5" />
      <polyline points="15 19 12 22 9 19" />
      <polyline points="19 9 22 12 19 15" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <line x1="12" y1="2" x2="12" y2="22" />
    </svg>
  );

  const PlusIcon = () => (
    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );

  const DuplicateIcon = () => (
    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <rect x="4" y="4" width="12" height="12" rx="2" />
    </svg>
  );

  const PasteIcon = () => (
    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2" />
      <rect x="8" y="2" width="8" height="4" rx="1" />
    </svg>
  );

  const MoreIcon = () => (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="1" fill="currentColor" />
      <circle cx="19" cy="12" r="1" fill="currentColor" />
      <circle cx="5" cy="12" r="1" fill="currentColor" />
    </svg>
  );

  const MoreIconVertical = () => (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="5" r="1" fill="currentColor" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
      <circle cx="12" cy="19" r="1" fill="currentColor" />
    </svg>
  );

  // Close expanded menus when clicking outside
  useEffect(() => {
    if (!cornerToolbarExpanded && !expandedEdge) return;
    
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-bobbin="control-handles"]')) return;
      
      setCornerToolbarExpanded(false);
      setExpandedEdge(null);
    };
    
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);
    
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [cornerToolbarExpanded, expandedEdge]);

  // Handle mouse move during drag to find drop target
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return;
    
    // Get element at point, excluding bobbin elements
    const elementsAtPoint = document.elementsFromPoint(e.clientX, e.clientY);
    const target = elementsAtPoint.find(el => 
      !el.hasAttribute('data-bobbin') && 
      el !== selectedElement.element &&
      !selectedElement.element.contains(el) &&
      el instanceof HTMLElement &&
      el.tagName !== 'HTML' &&
      el.tagName !== 'BODY'
    ) as HTMLElement | undefined;
    
    if (target !== dropTarget) {
      // Remove highlight from previous target
      if (dropTarget) {
        dropTarget.style.outline = '';
        dropTarget.style.outlineOffset = '';
      }
      
      // Highlight new target
      if (target) {
        target.style.outline = '2px dashed #3b82f6';
        target.style.outlineOffset = '2px';
      }
      
      setDropTarget(target || null);
    }
  }, [isDragging, dropTarget, selectedElement.element]);

  // Handle mouse up to complete drag
  const handleMouseUp = useCallback(() => {
    if (isDragging && dropTarget) {
      // Move element after the drop target
      const parent = dropTarget.parentElement;
      if (parent) {
        const index = Array.from(parent.children).indexOf(dropTarget) + 1;
        actions.moveElement(parent, index);
      }
      
      // Clean up highlight
      dropTarget.style.outline = '';
      dropTarget.style.outlineOffset = '';
    }
    
    setIsDragging(false);
    setDropTarget(null);
  }, [isDragging, dropTarget, actions]);

  // Set up global event listeners for drag
  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'grabbing';
    }
    
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      
      // Clean up any lingering highlight
      if (dropTarget) {
        dropTarget.style.outline = '';
        dropTarget.style.outlineOffset = '';
      }
    };
  }, [isDragging, handleMouseMove, handleMouseUp, dropTarget]);

  const handleMoveStart = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setIsDragging(true);
  };

  // Edge hover zone styles - invisible by default, shows actions on hover
  const getEdgeZoneStyle = (position: HandlePosition): React.CSSProperties => {
    const isHorizontal = position === 'top' || position === 'bottom';
    
    const base: React.CSSProperties = {
      position: 'fixed',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '3px',
      zIndex,
      transition: 'opacity 0.1s ease',
      pointerEvents: 'auto',
    };

    if (isHorizontal) {
      return {
        ...base,
        left: rect.left,
        width: rect.width,
        height: HOVER_ZONE_SIZE,
        top: position === 'top' ? rect.top - HOVER_ZONE_SIZE : rect.bottom,
        flexDirection: 'row',
      };
    } else {
      return {
        ...base,
        top: rect.top,
        height: rect.height,
        width: HOVER_ZONE_SIZE,
        left: position === 'left' ? rect.left - HOVER_ZONE_SIZE : rect.right,
        flexDirection: 'column',
      };
    }
  };

  // Check if an edge needs collapse based on position
  const edgeNeedsCollapse = (position: HandlePosition): boolean => {
    const isHorizontal = position === 'top' || position === 'bottom';
    return isHorizontal ? isShortForHorizontalEdge : isShortForVerticalEdge;
  };

  // Small action button in edge hover zone - dark background like corner buttons
  const EdgeActionButton = ({
    icon,
    onClick,
    title,
    visible,
  }: {
    icon: React.ReactNode;
    onClick: () => void;
    title: string;
    visible: boolean;
  }) => {
    const [isHovered, setIsHovered] = useState(false);
    
    if (!visible) return null;

    return (
      <button
        style={{
          width: CORNER_HANDLE_SIZE,
          height: CORNER_HANDLE_SIZE,
          borderRadius: '3px',
          backgroundColor: isHovered ? '#27272a' : '#18181b',
          color: '#fafafa',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all 0.1s ease',
          boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.2)',
          pointerEvents: 'auto',
          flexShrink: 0,
        }}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          onClick();
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        title={title}
      >
        {icon}
      </button>
    );
  };

  // Drag-enabled action button for move
  const MoveActionButton = () => {
    const [isHovered, setIsHovered] = useState(false);
    
    return (
      <button
        style={{
          width: CORNER_HANDLE_SIZE,
          height: CORNER_HANDLE_SIZE,
          borderRadius: '3px',
          backgroundColor: isHovered ? '#27272a' : '#18181b',
          color: '#fafafa',
          border: 'none',
          cursor: isDragging ? 'grabbing' : 'grab',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all 0.1s ease',
          boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.2)',
          pointerEvents: 'auto',
          flexShrink: 0,
        }}
        onMouseDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setIsDragging(true);
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        title="Move element (drag to new location)"
      >
        <MoveIcon />
      </button>
    );
  };

  // Edge action buttons component (used both inline and in expanded popup)
  const EdgeButtons = ({ position }: { position: HandlePosition }) => {
    const insertDir = getInsertDirection(position);
    const isHorizontal = position === 'top' || position === 'bottom';
    const separator = isHorizontal 
      ? <div style={{ width: '1px', height: CORNER_HANDLE_SIZE, backgroundColor: '#3f3f46', margin: '0 2px' }} />
      : <div style={{ height: '1px', width: CORNER_HANDLE_SIZE, backgroundColor: '#3f3f46', margin: '2px 0' }} />;
    
    return (
      <>
        {/* Top edge gets the delete/copy buttons on left, then insert buttons, then move on right */}
        {position === 'top' && (
          <>
            <EdgeActionButton
              icon={<TrashIcon />}
              onClick={() => actions.deleteElement()}
              title="Delete element"
              visible={true}
            />
            <EdgeActionButton
              icon={<CopyIcon />}
              onClick={() => actions.copyElement()}
              title="Copy element"
              visible={true}
            />
            {separator}
          </>
        )}
        <EdgeActionButton
          icon={<PlusIcon />}
          onClick={() => actions.insertElement(insertDir)}
          title={`Add text ${insertDir}`}
          visible={true}
        />
        <EdgeActionButton
          icon={<PasteIcon />}
          onClick={() => actions.pasteElement(insertDir)}
          title={`Paste ${insertDir}`}
          visible={!!clipboard}
        />
        <EdgeActionButton
          icon={<DuplicateIcon />}
          onClick={actions.duplicateElement}
          title="Duplicate element"
          visible={true}
        />
        {/* Move button on the right side of top edge bar */}
        {position === 'top' && (
          <>
            {separator}
            <MoveActionButton />
          </>
        )}
      </>
    );
  };

  // Expanded popup for collapsed edge zones
  const EdgeExpandedPopup = ({ position }: { position: HandlePosition }) => {
    const isHorizontal = position === 'top' || position === 'bottom';
    
    // Position the popup to extend in the direction it needs space
    const getPopupStyle = (): React.CSSProperties => {
      const base: React.CSSProperties = {
        position: 'absolute',
        display: 'flex',
        gap: '3px',
        padding: '4px',
        backgroundColor: '#18181b',
        borderRadius: '4px',
        boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.2)',
        zIndex: zIndex + 2,
      };

      if (isHorizontal) {
        // Horizontal edge: popup extends horizontally
        return {
          ...base,
          flexDirection: 'row',
          top: '50%',
          transform: 'translateY(-50%)',
          left: position === 'top' || position === 'bottom' ? '50%' : undefined,
          ...(position === 'top' || position === 'bottom' ? { transform: 'translate(-50%, -50%)' } : {}),
        };
      } else {
        // Vertical edge: popup extends vertically
        return {
          ...base,
          flexDirection: 'column',
          left: '50%',
          transform: 'translateX(-50%)',
          top: '50%',
          ...(true ? { transform: 'translate(-50%, -50%)' } : {}),
        };
      }
    };

    return (
      <div style={getPopupStyle()}>
        <EdgeButtons position={position} />
      </div>
    );
  };

  // Determine insert direction based on edge and layout
  const getInsertDirection = (position: HandlePosition): 'before' | 'after' => {
    if (layoutDirection === 'horizontal') {
      return position === 'left' ? 'before' : 'after';
    } else {
      return position === 'top' ? 'before' : 'after';
    }
  };

  const [cornerHover, setCornerHover] = useState<'delete' | 'copy' | 'move' | 'more' | null>(null);

  // Action button component for consistent styling and behavior
  const ActionButton = ({
    icon,
    onClick,
    onMouseDown,
    title,
    hoverKey,
    cursor,
  }: {
    icon: React.ReactNode;
    onClick?: (e: React.MouseEvent) => void;
    onMouseDown?: (e: React.MouseEvent) => void;
    title: string;
    hoverKey: 'delete' | 'copy' | 'move' | 'more';
    cursor?: string;
  }) => (
    <button
      style={{
        width: CORNER_HANDLE_SIZE,
        height: CORNER_HANDLE_SIZE,
        borderRadius: '3px',
        backgroundColor: cornerHover === hoverKey ? '#27272a' : '#18181b',
        color: '#fafafa',
        border: 'none',
        cursor: cursor || 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'background-color 0.1s ease',
        boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.2)',
        pointerEvents: 'auto',
        flexShrink: 0,
      }}
      onClick={onClick}
      onMouseDown={onMouseDown}
      onMouseEnter={() => setCornerHover(hoverKey)}
      onMouseLeave={() => setCornerHover(null)}
      title={title}
    >
      {icon}
    </button>
  );

  // Toolbar buttons (always the same, rendered conditionally based on narrow state)
  const ToolbarButtons = () => (
    <>
      <ActionButton
        icon={<MoveIcon />}
        onMouseDown={handleMoveStart}
        title="Move element (drag to new location)"
        hoverKey="move"
        cursor={isDragging ? 'grabbing' : 'grab'}
      />
      <ActionButton
        icon={<TrashIcon />}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          actions.deleteElement();
        }}
        title="Delete element"
        hoverKey="delete"
      />
      <ActionButton
        icon={<CopyIcon />}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          actions.copyElement();
        }}
        title="Copy element"
        hoverKey="copy"
      />
    </>
  );

  return (
    <div data-bobbin="control-handles" style={{ pointerEvents: 'none' }}>
      {/* Edge hover zones with action buttons */}
      {(['top', 'bottom', 'left', 'right'] as HandlePosition[]).map((position) => {
        const isHovered = hoveredEdge === position;
        
        return (
          <div
            key={position}
            style={getEdgeZoneStyle(position)}
            onMouseEnter={() => setHoveredEdge(position)}
            onMouseLeave={() => setHoveredEdge(null)}
          >
            {isHovered && <EdgeButtons position={position} />}
          </div>
        );
      })}
    </div>
  );
}
