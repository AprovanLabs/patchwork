import { useState, useMemo } from 'react';

interface ColorPickerProps {
  value: string;
  colors: Record<string, Record<string, string>>;
  onChange: (value: string) => void;
}

export function ColorPicker({ value, colors, onChange }: ColorPickerProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Flatten colors for display
  const colorGrid = useMemo(() => {
    const grid: Array<{ name: string; shade: string; value: string }> = [];
    for (const [name, shades] of Object.entries(colors)) {
      if (typeof shades === 'object') {
        for (const [shade, colorValue] of Object.entries(shades)) {
          grid.push({ name, shade, value: colorValue });
        }
      }
    }
    return grid;
  }, [colors]);

  // Get common shades for compact view
  const commonShades = ['500', '600', '700'];
  const compactColors = useMemo(() => {
    return colorGrid.filter(c => commonShades.includes(c.shade));
  }, [colorGrid]);

  return (
    <div>
      {/* Current color preview */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          marginBottom: '6px',
        }}
      >
        <div
          style={{
            width: '22px',
            height: '22px',
            borderRadius: '4px',
            backgroundColor: value,
            border: '1px solid #e4e4e7',
            boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.06)',
          }}
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{
            flex: 1,
            backgroundColor: '#ffffff',
            border: '1px solid #e4e4e7',
            borderRadius: '4px',
            padding: '4px 8px',
            color: '#18181b',
            fontSize: '11px',
            fontFamily: 'ui-monospace, monospace',
          }}
        />
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          style={{
            padding: '4px 6px',
            borderRadius: '4px',
            border: '1px solid #e4e4e7',
            backgroundColor: '#ffffff',
            color: '#71717a',
            fontSize: '10px',
            cursor: 'pointer',
          }}
        >
          {isExpanded ? '▲' : '▼'}
        </button>
      </div>

      {/* Color grid */}
      {isExpanded && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(11, 1fr)',
            gap: '2px',
            padding: '6px',
            backgroundColor: '#fafafa',
            border: '1px solid #e4e4e7',
            borderRadius: '8px',
            maxHeight: '200px',
            overflow: 'auto',
          }}
        >
          {colorGrid.map((color, i) => (
            <button
              key={i}
              onClick={() => onChange(color.value)}
              style={{
                width: '18px',
                height: '18px',
                borderRadius: '3px',
                backgroundColor: color.value,
                border: value === color.value ? '2px solid #18181b' : '1px solid #e4e4e7',
                cursor: 'pointer',
              }}
              title={`${color.name}-${color.shade}`}
            />
          ))}
        </div>
      )}

      {/* Compact color swatches */}
      {!isExpanded && (
        <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
          {compactColors.map((color, i) => (
            <button
              key={i}
              onClick={() => onChange(color.value)}
              style={{
                width: '14px',
                height: '14px',
                borderRadius: '3px',
                backgroundColor: color.value,
                border: value === color.value ? '2px solid #18181b' : '1px solid #e4e4e7',
                cursor: 'pointer',
              }}
              title={`${color.name}-${color.shade}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
