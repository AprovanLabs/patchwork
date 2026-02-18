import { useState } from 'react';
import type { DesignTokens } from '../../../types';
import { SectionWrapper } from './SectionWrapper';
import { SliderInput } from '../controls/SliderInput';

// Common size presets
const sizePresets: Record<string, string> = {
  'auto': 'auto',
  'full': '100%',
  'fit': 'fit-content',
  'min': 'min-content',
  'max': 'max-content',
  'screen': '100vh',
};

interface SizeSectionProps {
  expanded: boolean;
  onToggle: () => void;
  computedStyle: CSSStyleDeclaration;
  onApplyStyle: (property: string, value: string) => void;
  tokens: DesignTokens;
  hasChanges?: boolean;
}

// Component for size input with quick presets and slider
function SizeInput({
  label,
  value,
  property,
  onApplyStyle,
}: {
  label: string;
  value: string;
  property: string;
  onApplyStyle: (property: string, value: string) => void;
}) {
  const [showSlider, setShowSlider] = useState(false);
  const numericValue = parseFloat(value) || 0;

  // Check if current value matches a preset
  const isPresetSelected = (presetValue: string) => {
    return value.toLowerCase() === presetValue.toLowerCase();
  };

  return (
    <div style={{ marginBottom: '10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
        <label style={{ fontSize: '10px', color: '#71717a' }}>{label}</label>
        <button
          onClick={() => setShowSlider(!showSlider)}
          style={{
            padding: '1px 4px',
            borderRadius: '2px',
            border: '1px solid #e4e4e7',
            backgroundColor: showSlider ? '#18181b' : '#ffffff',
            color: showSlider ? '#fafafa' : '#71717a',
            fontSize: '8px',
            cursor: 'pointer',
          }}
          title="Toggle custom size slider"
        >
          px
        </button>
      </div>
      
      {/* Quick presets */}
      <div style={{ display: 'flex', gap: '2px', flexWrap: 'wrap', marginBottom: showSlider ? '6px' : 0 }}>
        {Object.entries(sizePresets).slice(0, 5).map(([key, presetValue]) => (
          <button
            key={key}
            onClick={() => onApplyStyle(property, presetValue)}
            style={{
              padding: '2px 5px',
              borderRadius: '3px',
              border: '1px solid',
              borderColor: isPresetSelected(presetValue) ? '#18181b' : '#e4e4e7',
              backgroundColor: isPresetSelected(presetValue) ? '#18181b' : '#ffffff',
              color: isPresetSelected(presetValue) ? '#fafafa' : '#18181b',
              fontSize: '9px',
              fontFamily: 'ui-monospace, monospace',
              cursor: 'pointer',
              transition: 'all 0.1s ease',
            }}
            title={presetValue}
          >
            {key}
          </button>
        ))}
      </div>

      {/* Slider for custom values */}
      {showSlider && (
        <SliderInput
          value={numericValue}
          min={0}
          max={1000}
          onChange={(v) => onApplyStyle(property, `${v}px`)}
        />
      )}
    </div>
  );
}

export function SizeSection({
  expanded,
  onToggle,
  computedStyle,
  onApplyStyle,
  hasChanges = false,
}: SizeSectionProps) {
  const width = computedStyle.width;
  const height = computedStyle.height;
  const minWidth = computedStyle.minWidth;
  const maxWidth = computedStyle.maxWidth;
  const minHeight = computedStyle.minHeight;
  const maxHeight = computedStyle.maxHeight;

  return (
    <SectionWrapper title="Size" expanded={expanded} onToggle={onToggle} hasChanges={hasChanges}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        <SizeInput
          label="Width"
          value={width}
          property="width"
          onApplyStyle={onApplyStyle}
        />
        <SizeInput
          label="Height"
          value={height}
          property="height"
          onApplyStyle={onApplyStyle}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        <SizeInput
          label="Min W"
          value={minWidth}
          property="min-width"
          onApplyStyle={onApplyStyle}
        />
        <SizeInput
          label="Max W"
          value={maxWidth}
          property="max-width"
          onApplyStyle={onApplyStyle}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        <SizeInput
          label="Min H"
          value={minHeight}
          property="min-height"
          onApplyStyle={onApplyStyle}
        />
        <SizeInput
          label="Max H"
          value={maxHeight}
          property="max-height"
          onApplyStyle={onApplyStyle}
        />
      </div>
    </SectionWrapper>
  );
}
