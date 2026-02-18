import { useState, useLayoutEffect } from 'react';
import type { BobbinState, BobbinActions } from '../../types';

interface PillProps {
  state: BobbinState;
  actions: BobbinActions;
  position?: { bottom: number; right: number };
  container?: HTMLElement | null;
  zIndex?: number;
}

// Copy icon
const CopyIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
  </svg>
);

// Edit icon (pencil)
const EditIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
  </svg>
);

export function Pill({ state, actions, position, container, zIndex = 9999 }: PillProps) {
  const [copyHovered, setCopyHovered] = useState(false);
  const [copied, setCopied] = useState(false);
  const [computedPosition, setComputedPosition] = useState<{ bottom: number; right: number } | null>(null);
  
  const offset = position ?? { bottom: 16, right: 16 };

  // Calculate position relative to container if provided
  useLayoutEffect(() => {
    if (!container) {
      setComputedPosition(null);
      return;
    }

    const updatePosition = () => {
      const rect = container.getBoundingClientRect();
      // Position from viewport edges based on container position
      setComputedPosition({
        bottom: window.innerHeight - rect.bottom + offset.bottom,
        right: window.innerWidth - rect.right + offset.right,
      });
    };

    updatePosition();
    
    // Update on resize/scroll
    const observer = new ResizeObserver(updatePosition);
    observer.observe(container);
    window.addEventListener('scroll', updatePosition, true);
    
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [container, offset.bottom, offset.right]);

  const pos = computedPosition ?? offset;

  const handleClick = () => {
    if (state.isActive) {
      actions.deactivate();
    } else {
      actions.activate();
    }
  };

  const handleCopyChanges = (e: React.MouseEvent) => {
    e.stopPropagation();
    const yaml = actions.exportChanges();
    navigator.clipboard.writeText(yaml);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // ShadCN-style: minimal black/white with subtle borders
  return (
    <div
      data-bobbin="pill"
      className="bobbin-pill"
      style={{
        position: 'fixed',
        bottom: pos.bottom,
        right: pos.right,
        zIndex,
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '6px 10px',
        borderRadius: '9999px',
        backgroundColor: state.isActive ? '#18181b' : '#fafafa',
        color: state.isActive ? '#fafafa' : '#18181b',
        border: '1px solid #e4e4e7',
        cursor: 'pointer',
        boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
        transition: 'all 0.15s ease',
        userSelect: 'none',
        fontSize: '13px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
      onClick={handleClick}
    >
      {/* Edit Icon */}
      <EditIcon />

      {/* Change count badge with copy button - shows for changes OR annotations */}
      {(state.changes.length > 0 || state.annotations.length > 0) && (
        <button
          onClick={handleCopyChanges}
          onMouseEnter={() => setCopyHovered(true)}
          onMouseLeave={() => setCopyHovered(false)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            padding: '2px 6px',
            borderRadius: '9999px',
            backgroundColor: state.isActive ? '#fafafa' : '#18181b',
            color: state.isActive ? '#18181b' : '#fafafa',
            fontSize: '11px',
            fontWeight: 500,
            border: 'none',
            cursor: 'pointer',
            transition: 'all 0.1s ease',
          }}
          title="Copy changes as YAML"
        >
          <span>{state.changes.length + state.annotations.length}</span>
          {copyHovered && <CopyIcon />}
          {copied && <span style={{ fontSize: '10px' }}>✓</span>}
        </button>
      )}

      {/* Clipboard indicator */}
      {state.clipboard && (
        <div
          style={{
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            backgroundColor: state.isActive ? '#fafafa' : '#18181b',
            border: '1px solid #a1a1aa',
          }}
          title="Element copied"
        />
      )}
    </div>
  );
}
