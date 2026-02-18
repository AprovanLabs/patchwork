import { ReactNode } from 'react';

interface SectionWrapperProps {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
  hasChanges?: boolean;
}

export function SectionWrapper({ title, expanded, onToggle, children, hasChanges = false }: SectionWrapperProps) {
  return (
    <div style={{ borderBottom: '1px solid #f4f4f5' }}>
      <button
        onClick={onToggle}
        style={{
          width: '100%',
          padding: '8px 12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: hasChanges ? '#eff6ff' : 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: '#18181b',
          fontSize: '11px',
          fontWeight: 500,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {title}
          {hasChanges && (
            <span
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                backgroundColor: '#3b82f6',
              }}
              title="Has unsaved changes"
            />
          )}
        </span>
        <span style={{ fontSize: '10px', color: '#a1a1aa' }}>
          {expanded ? '▲' : '▼'}
        </span>
      </button>
      {expanded && (
        <div style={{ padding: '0 12px 12px' }}>
          {children}
        </div>
      )}
    </div>
  );
}
