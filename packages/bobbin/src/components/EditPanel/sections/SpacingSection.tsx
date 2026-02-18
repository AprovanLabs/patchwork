import type { DesignTokens } from '../../../types';
import { SectionWrapper } from './SectionWrapper';
import { SpacingControl } from '../controls/SpacingControl';

interface SpacingSectionProps {
  expanded: boolean;
  onToggle: () => void;
  computedStyle: CSSStyleDeclaration;
  onApplyStyle: (property: string, value: string) => void;
  tokens: DesignTokens;
  hasChanges?: boolean;
  changedProps?: Record<string, boolean>;
}

export function SpacingSection({
  expanded,
  onToggle,
  computedStyle,
  onApplyStyle,
  hasChanges = false,
  changedProps = {},
}: SpacingSectionProps) {
  const margin = {
    top: computedStyle.marginTop,
    right: computedStyle.marginRight,
    bottom: computedStyle.marginBottom,
    left: computedStyle.marginLeft,
  };

  const padding = {
    top: computedStyle.paddingTop,
    right: computedStyle.paddingRight,
    bottom: computedStyle.paddingBottom,
    left: computedStyle.paddingLeft,
  };

  const marginChanges = {
    top: changedProps['margin-top'],
    right: changedProps['margin-right'],
    bottom: changedProps['margin-bottom'],
    left: changedProps['margin-left'],
  };

  const paddingChanges = {
    top: changedProps['padding-top'],
    right: changedProps['padding-right'],
    bottom: changedProps['padding-bottom'],
    left: changedProps['padding-left'],
  };

  return (
    <SectionWrapper title="Spacing" expanded={expanded} onToggle={onToggle} hasChanges={hasChanges}>
      <div style={{ marginBottom: '16px' }}>
        <SpacingControl
          label="Margin"
          values={margin}
          onChange={(side, value) => onApplyStyle(`margin-${side}`, value)}
          hasChanges={marginChanges}
        />
      </div>
      <SpacingControl
        label="Padding"
        values={padding}
        onChange={(side, value) => onApplyStyle(`padding-${side}`, value)}
        hasChanges={paddingChanges}
      />
    </SectionWrapper>
  );
}
