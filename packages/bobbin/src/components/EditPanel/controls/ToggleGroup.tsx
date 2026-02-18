import type { ReactNode } from 'react';

interface ToggleGroupProps {
  value: string;
  options: Array<{ value: string; label: ReactNode }>;
  onChange: (value: string) => void;
}

export function ToggleGroup({ value, options, onChange }: ToggleGroupProps) {
  return (
    <div style={{ display: 'flex', gap: '2px' }}>
      {options.map(option => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          style={{
            flex: 1,
            padding: '4px 6px',
            borderRadius: '4px',
            border: '1px solid #e4e4e7',
            backgroundColor: value === option.value ? '#18181b' : '#ffffff',
            color: value === option.value ? '#fafafa' : '#71717a',
            cursor: 'pointer',
            fontSize: '10px',
            fontWeight: 500,
            transition: 'all 0.1s ease',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
