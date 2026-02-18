import type { DesignTokens } from '../../../types';
import { SectionWrapper } from './SectionWrapper';
import { QuickSelectDropdown } from '../controls/QuickSelectDropdown';
import { SliderInput } from '../controls/SliderInput';

interface EffectsSectionProps {
  expanded: boolean;
  onToggle: () => void;
  computedStyle: CSSStyleDeclaration;
  onApplyStyle: (property: string, value: string) => void;
  tokens: DesignTokens;
  hasChanges?: boolean;
}

export function EffectsSection({
  expanded,
  onToggle,
  computedStyle,
  onApplyStyle,
  tokens,
  hasChanges = false,
}: EffectsSectionProps) {
  const boxShadow = computedStyle.boxShadow;
  const borderRadius = computedStyle.borderRadius;
  const borderWidth = computedStyle.borderWidth;
  const opacity = parseFloat(computedStyle.opacity) * 100;

  return (
    <SectionWrapper title="Effects" expanded={expanded} onToggle={onToggle} hasChanges={hasChanges}>
      {/* Border Radius */}
      <div style={{ marginBottom: '12px' }}>
        <label style={{ fontSize: '10px', color: '#71717a', marginBottom: '4px', display: 'block' }}>
          Border Radius
        </label>
        <QuickSelectDropdown
          value={borderRadius}
          tokens={tokens.borderRadius}
          quickKeys={['none', 'sm', 'md', 'lg', 'full']}
          onChange={(value) => onApplyStyle('border-radius', value)}
        />
      </div>

      {/* Border Width */}
      <div style={{ marginBottom: '12px' }}>
        <label style={{ fontSize: '10px', color: '#71717a', marginBottom: '4px', display: 'block' }}>
          Border Width
        </label>
        <QuickSelectDropdown
          value={borderWidth}
          tokens={tokens.borderWidth}
          quickKeys={['0', 'DEFAULT', '2', '4']}
          onChange={(value) => onApplyStyle('border-width', value)}
        />
      </div>

      {/* Box Shadow */}
      <div style={{ marginBottom: '12px' }}>
        <label style={{ fontSize: '10px', color: '#71717a', marginBottom: '4px', display: 'block' }}>
          Shadow
        </label>
        <QuickSelectDropdown
          value={boxShadow}
          tokens={tokens.boxShadow}
          quickKeys={['none', 'sm', 'md', 'lg']}
          onChange={(value) => onApplyStyle('box-shadow', value)}
        />
      </div>

      {/* Opacity */}
      <div>
        <label style={{ fontSize: '10px', color: '#71717a', marginBottom: '4px', display: 'block' }}>
          Opacity
        </label>
        <SliderInput
          value={opacity}
          min={0}
          max={100}
          step={1}
          unit="%"
          onChange={(value) => onApplyStyle('opacity', String(value / 100))}
        />
      </div>
    </SectionWrapper>
  );
}
