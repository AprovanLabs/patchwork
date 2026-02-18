import type { DesignTokens } from '../../../types';
import { SectionWrapper } from './SectionWrapper';
import { ColorPicker } from '../controls/ColorPicker';
import { TokenDropdown } from '../controls/TokenDropdown';

interface BackgroundSectionProps {
  expanded: boolean;
  onToggle: () => void;
  computedStyle: CSSStyleDeclaration;
  onApplyStyle: (property: string, value: string) => void;
  tokens: DesignTokens;
  hasChanges?: boolean;
}

export function BackgroundSection({
  expanded,
  onToggle,
  computedStyle,
  onApplyStyle,
  tokens,
  hasChanges = false,
}: BackgroundSectionProps) {
  const backgroundColor = computedStyle.backgroundColor;
  const borderColor = computedStyle.borderColor;
  const borderWidth = computedStyle.borderWidth;
  const borderRadius = computedStyle.borderRadius;

  return (
    <SectionWrapper title="Background & Border" expanded={expanded} onToggle={onToggle} hasChanges={hasChanges}>
      {/* Background Color */}
      <div style={{ marginBottom: '12px' }}>
        <label style={{ fontSize: '10px', color: '#71717a', marginBottom: '4px', display: 'block' }}>
          Background
        </label>
        <ColorPicker
          value={backgroundColor}
          colors={tokens.colors}
          onChange={(value) => onApplyStyle('background-color', value)}
        />
      </div>

      {/* Border Color */}
      <div style={{ marginBottom: '12px' }}>
        <label style={{ fontSize: '10px', color: '#71717a', marginBottom: '4px', display: 'block' }}>
          Border Color
        </label>
        <ColorPicker
          value={borderColor}
          colors={tokens.colors}
          onChange={(value) => onApplyStyle('border-color', value)}
        />
      </div>

      {/* Border Width */}
      <div style={{ marginBottom: '12px' }}>
        <label style={{ fontSize: '10px', color: '#71717a', marginBottom: '4px', display: 'block' }}>
          Border Width
        </label>
        <TokenDropdown
          value={borderWidth}
          tokens={tokens.borderWidth}
          onChange={(value) => onApplyStyle('border-width', value)}
        />
      </div>

      {/* Border Radius */}
      <div>
        <label style={{ fontSize: '10px', color: '#71717a', marginBottom: '4px', display: 'block' }}>
          Border Radius
        </label>
        <TokenDropdown
          value={borderRadius}
          tokens={tokens.borderRadius}
          onChange={(value) => onApplyStyle('border-radius', value)}
        />
      </div>
    </SectionWrapper>
  );
}
