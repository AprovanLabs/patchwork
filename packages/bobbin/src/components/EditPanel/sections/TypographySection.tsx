import type { DesignTokens } from '../../../types';
import { SectionWrapper } from './SectionWrapper';
import { TokenDropdown } from '../controls/TokenDropdown';
import { QuickSelectDropdown } from '../controls/QuickSelectDropdown';
import { ColorPicker } from '../controls/ColorPicker';
import { ToggleGroup } from '../controls/ToggleGroup';

// Text alignment icons
const AlignLeftIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="3" y1="6" x2="21" y2="6" />
    <line x1="3" y1="12" x2="15" y2="12" />
    <line x1="3" y1="18" x2="18" y2="18" />
  </svg>
);

const AlignCenterIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="3" y1="6" x2="21" y2="6" />
    <line x1="6" y1="12" x2="18" y2="12" />
    <line x1="4" y1="18" x2="20" y2="18" />
  </svg>
);

const AlignRightIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="3" y1="6" x2="21" y2="6" />
    <line x1="9" y1="12" x2="21" y2="12" />
    <line x1="6" y1="18" x2="21" y2="18" />
  </svg>
);

const AlignJustifyIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="3" y1="6" x2="21" y2="6" />
    <line x1="3" y1="12" x2="21" y2="12" />
    <line x1="3" y1="18" x2="21" y2="18" />
  </svg>
);

interface TypographySectionProps {
  expanded: boolean;
  onToggle: () => void;
  computedStyle: CSSStyleDeclaration;
  onApplyStyle: (property: string, value: string) => void;
  tokens: DesignTokens;
  hasChanges?: boolean;
}

export function TypographySection({
  expanded,
  onToggle,
  computedStyle,
  onApplyStyle,
  tokens,
  hasChanges = false,
}: TypographySectionProps) {
  const color = computedStyle.color;
  const fontSize = computedStyle.fontSize;
  const fontWeight = computedStyle.fontWeight;
  const fontFamily = computedStyle.fontFamily;
  const textAlign = computedStyle.textAlign;
  const lineHeight = computedStyle.lineHeight;

  return (
    <SectionWrapper title="Typography" expanded={expanded} onToggle={onToggle} hasChanges={hasChanges}>
      {/* Color */}
      <div style={{ marginBottom: '12px' }}>
        <label style={{ fontSize: '10px', color: '#71717a', marginBottom: '4px', display: 'block' }}>
          Color
        </label>
        <ColorPicker
          value={color}
          colors={tokens.colors}
          onChange={(value) => onApplyStyle('color', value)}
        />
      </div>

      {/* Font Size */}
      <div style={{ marginBottom: '12px' }}>
        <label style={{ fontSize: '10px', color: '#71717a', marginBottom: '4px', display: 'block' }}>
          Font Size
        </label>
        <QuickSelectDropdown
          value={fontSize}
          tokens={tokens.fontSize}
          quickKeys={['xs', 'sm', 'base', 'lg', 'xl', '2xl']}
          onChange={(value) => onApplyStyle('font-size', value)}
        />
      </div>

      {/* Font Weight */}
      <div style={{ marginBottom: '12px' }}>
        <label style={{ fontSize: '10px', color: '#71717a', marginBottom: '4px', display: 'block' }}>
          Font Weight
        </label>
        <QuickSelectDropdown
          value={fontWeight}
          tokens={tokens.fontWeight}
          quickKeys={['light', 'normal', 'medium', 'semibold', 'bold']}
          onChange={(value) => onApplyStyle('font-weight', value)}
        />
      </div>

      {/* Font Family */}
      <div style={{ marginBottom: '12px' }}>
        <label style={{ fontSize: '10px', color: '#71717a', marginBottom: '4px', display: 'block' }}>
          Font Family
        </label>
        <TokenDropdown
          value={fontFamily}
          tokens={tokens.fontFamily}
          onChange={(value) => onApplyStyle('font-family', value)}
        />
      </div>

      {/* Text Align */}
      <div style={{ marginBottom: '12px' }}>
        <label style={{ fontSize: '10px', color: '#71717a', marginBottom: '4px', display: 'block' }}>
          Text Align
        </label>
        <ToggleGroup
          value={textAlign}
          options={[
            { value: 'left', label: <AlignLeftIcon /> },
            { value: 'center', label: <AlignCenterIcon /> },
            { value: 'right', label: <AlignRightIcon /> },
            { value: 'justify', label: <AlignJustifyIcon /> },
          ]}
          onChange={(value) => onApplyStyle('text-align', value)}
        />
      </div>

      {/* Line Height */}
      <div>
        <label style={{ fontSize: '10px', color: '#71717a', marginBottom: '4px', display: 'block' }}>
          Line Height
        </label>
        <QuickSelectDropdown
          value={lineHeight}
          tokens={tokens.lineHeight}
          quickKeys={['tight', 'snug', 'normal', 'relaxed']}
          onChange={(value) => onApplyStyle('line-height', value)}
        />
      </div>
    </SectionWrapper>
  );
}
