import { useState, useCallback, useRef, useEffect } from 'react';

type Side = 'top' | 'right' | 'bottom' | 'left';

interface SpacingControlProps {
  values: { top: string; right: string; bottom: string; left: string };
  onChange: (side: Side, value: string) => void;
  label: string;
  hasChanges?: { top?: boolean; right?: boolean; bottom?: boolean; left?: boolean };
}

// Chain link icon (for linked sides)
const ChainIcon = ({ linked }: { linked: boolean }) => (
  <svg 
    width="12" 
    height="12" 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ opacity: linked ? 1 : 0.4 }}
  >
    {linked ? (
      // Linked chain
      <>
        <path d="M9 17H7A5 5 0 0 1 7 7h2" />
        <path d="M15 7h2a5 5 0 1 1 0 10h-2" />
        <line x1="8" y1="12" x2="16" y2="12" />
      </>
    ) : (
      // Broken chain
      <>
        <path d="M9 17H7A5 5 0 0 1 7 7h2" />
        <path d="M15 7h2a5 5 0 1 1 0 10h-2" />
        <line x1="8" y1="12" x2="10" y2="12" />
        <line x1="14" y1="12" x2="16" y2="12" />
      </>
    )}
  </svg>
);

// Check if a CSS value is valid
function isValidCSSValue(value: string): boolean {
  if (!value || value.trim() === '') return true; // Empty is valid (will revert to default)
  
  // Common valid patterns
  const validPatterns = [
    /^-?\d+(\.\d+)?(px|em|rem|%|vh|vw|pt|cm|mm|in|pc)?$/i,
    /^auto$/i,
    /^inherit$/i,
    /^initial$/i,
    /^unset$/i,
    /^0$/,
  ];
  
  return validPatterns.some(pattern => pattern.test(value.trim()));
}

export function SpacingControl({ values, onChange, label, hasChanges = {} }: SpacingControlProps) {
  const [editingSide, setEditingSide] = useState<Side | null>(null);
  const [editValue, setEditValue] = useState('');
  const [linkVertical, setLinkVertical] = useState(false);
  const [linkHorizontal, setLinkHorizontal] = useState(false);
  const [highlightLinked, setHighlightLinked] = useState<'vertical' | 'horizontal' | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when editing starts
  useEffect(() => {
    if (editingSide && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingSide]);

  const handleChange = useCallback((side: Side, value: string) => {
    onChange(side, value);
    
    // Apply linked changes
    if (linkVertical && (side === 'top' || side === 'bottom')) {
      onChange(side === 'top' ? 'bottom' : 'top', value);
    }
    if (linkHorizontal && (side === 'left' || side === 'right')) {
      onChange(side === 'left' ? 'right' : 'left', value);
    }
  }, [onChange, linkVertical, linkHorizontal]);

  const handleBoxClick = (side: Side, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingSide(side);
    setEditValue(values[side]);
    
    // Highlight linked sides
    if (linkVertical && (side === 'top' || side === 'bottom')) {
      setHighlightLinked('vertical');
    } else if (linkHorizontal && (side === 'left' || side === 'right')) {
      setHighlightLinked('horizontal');
    }
  };

  const handleInputChange = (value: string) => {
    setEditValue(value);
    // Apply changes even if temporarily invalid (user is typing)
    if (editingSide) {
      handleChange(editingSide, value);
    }
  };

  const handleInputBlur = () => {
    setEditingSide(null);
    setHighlightLinked(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === 'Escape') {
      setEditingSide(null);
      setHighlightLinked(null);
    }
  };

  const formatValue = (value: string) => {
    // Extract just the numeric value for compact display
    const match = value.match(/^([\d.]+)/);
    return match ? match[1] : value || '0';
  };

  const isLinkedHighlighted = (side: Side): boolean => {
    if (!highlightLinked) return false;
    if (highlightLinked === 'vertical' && (side === 'top' || side === 'bottom')) return true;
    if (highlightLinked === 'horizontal' && (side === 'left' || side === 'right')) return true;
    return false;
  };

  const getBoxStyle = (side: Side): React.CSSProperties => {
    const isEditing = editingSide === side;
    const isLinked = isLinkedHighlighted(side);
    const isValid = isEditing ? isValidCSSValue(editValue) : true;
    const hasChange = hasChanges[side];
    
    return {
      padding: isEditing ? '0' : '2px 4px',
      borderRadius: '3px',
      border: `1px solid ${
        !isValid ? '#ef4444' : 
        hasChange ? '#3b82f6' : 
        isLinked ? '#8b5cf6' :
        isEditing ? '#18181b' : 
        '#e4e4e7'
      }`,
      backgroundColor: 
        !isValid ? '#fef2f2' :
        hasChange ? '#eff6ff' : 
        isLinked ? '#f5f3ff' :
        '#ffffff',
      color: '#18181b',
      fontSize: '9px',
      textAlign: 'center',
      cursor: 'text',
      minWidth: '28px',
      transition: 'all 0.1s ease',
      outline: 'none',
    };
  };

  const linkButtonStyle = (active: boolean): React.CSSProperties => ({
    padding: '2px 4px',
    borderRadius: '3px',
    border: `1px solid ${active ? '#8b5cf6' : '#e4e4e7'}`,
    backgroundColor: active ? '#f5f3ff' : '#ffffff',
    color: active ? '#8b5cf6' : '#71717a',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.1s ease',
  });

  const renderValueBox = (side: Side, position: React.CSSProperties) => {
    const isEditing = editingSide === side;
    
    return (
      <div style={{ position: 'absolute', ...position }}>
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            value={editValue}
            onChange={(e) => handleInputChange(e.target.value)}
            onBlur={handleInputBlur}
            onKeyDown={handleKeyDown}
            style={{
              ...getBoxStyle(side),
              width: '36px',
              fontFamily: 'inherit',
            }}
          />
        ) : (
          <div
            onClick={(e) => handleBoxClick(side, e)}
            style={getBoxStyle(side)}
            title={`${side}: ${values[side]}`}
          >
            {formatValue(values[side])}
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
        <label style={{ fontSize: '10px', color: '#71717a' }}>
          {label}
        </label>
        <div style={{ display: 'flex', gap: '2px' }}>
          <button
            style={linkButtonStyle(linkVertical)}
            onClick={() => setLinkVertical(!linkVertical)}
            title={linkVertical ? 'Unlink top/bottom' : 'Link top/bottom'}
          >
            <span style={{ transform: 'rotate(90deg)', display: 'flex' }}>
              <ChainIcon linked={linkVertical} />
            </span>
          </button>
          <button
            style={linkButtonStyle(linkHorizontal)}
            onClick={() => setLinkHorizontal(!linkHorizontal)}
            title={linkHorizontal ? 'Unlink left/right' : 'Link left/right'}
          >
            <ChainIcon linked={linkHorizontal} />
          </button>
        </div>
      </div>
      
      {/* Visual spacing box with outline square in center */}
      <div 
        style={{ 
          position: 'relative',
          width: '100px',
          height: '40px',
          margin: '0 auto',
        }}
      >
        {/* Outline square connecting all sides */}
        <svg
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
          }}
          viewBox="0 0 100 70"
        >
          {/* Outer rectangle outline */}
          <rect
            x="10"
            y="10"
            width="80"
            height="50"
            fill="none"
            stroke="lightgray"
            strokeWidth="1"
            strokeDasharray="3,2"
            rx="2"
          />
          {/* Lines connecting to value boxes */}
          <line x1="50" y1="10" x2="50" y2="2" stroke="lightgray" strokeWidth="1" />
          <line x1="50" y1="60" x2="50" y2="68" stroke="lightgray" strokeWidth="1" />
          <line x1="10" y1="35" x2="2" y2="35" stroke="lightgray" strokeWidth="1" />
          <line x1="90" y1="35" x2="98" y2="35" stroke="lightgray" strokeWidth="1" />
        </svg>

        {/* Value boxes at each side */}
        {renderValueBox('top', { top: '-8px', left: '50%', transform: 'translateX(-50%)' })}
        {renderValueBox('bottom', { bottom: '-8px', left: '50%', transform: 'translateX(-50%)' })}
        {renderValueBox('left', { left: '-12px', top: '50%', transform: 'translateY(-50%)' })}
        {renderValueBox('right', { right: '-12px', top: '50%', transform: 'translateY(-50%)' })}
      </div>
    </div>
  );
}
