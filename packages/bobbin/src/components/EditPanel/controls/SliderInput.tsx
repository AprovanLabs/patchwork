import { useState, useCallback } from 'react';

interface SliderInputProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  onChange: (value: number) => void;
  label?: string;
}

export function SliderInput({
  value,
  min = 0,
  max = 100,
  step = 1,
  unit = 'px',
  onChange,
  label,
}: SliderInputProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [localValue, setLocalValue] = useState(value);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    const startX = e.clientX;
    const startValue = localValue;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - startX;
      const sensitivity = e.shiftKey ? 0.1 : 1; // Shift for fine control
      const newValue = Math.min(max, Math.max(min, startValue + delta * sensitivity));
      const steppedValue = Math.round(newValue / step) * step;
      setLocalValue(steppedValue);
      onChange(steppedValue);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [localValue, min, max, step, onChange]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = parseFloat(e.target.value) || 0;
    setLocalValue(newValue);
    onChange(newValue);
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      {label && (
        <span style={{ fontSize: '10px', color: '#71717a', width: '18px' }}>{label}</span>
      )}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          backgroundColor: '#ffffff',
          border: '1px solid #e4e4e7',
          borderRadius: '4px',
          padding: '3px 6px',
          cursor: 'ew-resize',
        }}
        onMouseDown={handleMouseDown}
      >
        <input
          type="number"
          value={localValue}
          onChange={handleInputChange}
          style={{
            width: '100%',
            backgroundColor: 'transparent',
            border: 'none',
            color: '#18181b',
            fontSize: '11px',
            fontFamily: 'ui-monospace, monospace',
            outline: 'none',
            cursor: isDragging ? 'ew-resize' : 'text',
          }}
          onClick={(e) => e.stopPropagation()}
        />
        <span style={{ fontSize: '10px', color: '#a1a1aa', marginLeft: '4px' }}>{unit}</span>
      </div>
    </div>
  );
}
