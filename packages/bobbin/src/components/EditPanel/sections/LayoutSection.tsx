import type { DesignTokens } from '../../../types';
import { SectionWrapper } from './SectionWrapper';
import { ToggleGroup } from '../controls/ToggleGroup';
import { TokenDropdown } from '../controls/TokenDropdown';

// Direction icons
const ArrowRightIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="5" y1="12" x2="19" y2="12" />
    <polyline points="12 5 19 12 12 19" />
  </svg>
);

const ArrowLeftIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="19" y1="12" x2="5" y2="12" />
    <polyline points="12 19 5 12 12 5" />
  </svg>
);

const ArrowDownIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="12" y1="5" x2="12" y2="19" />
    <polyline points="19 12 12 19 5 12" />
  </svg>
);

const ArrowUpIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="12" y1="19" x2="12" y2="5" />
    <polyline points="5 12 12 5 19 12" />
  </svg>
);

// Justify icons
const JustifyStartIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="3" y1="4" x2="3" y2="20" />
    <rect x="7" y="8" width="4" height="8" rx="1" />
    <rect x="13" y="8" width="4" height="8" rx="1" />
  </svg>
);

const JustifyCenterIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="6" y="8" width="4" height="8" rx="1" />
    <rect x="14" y="8" width="4" height="8" rx="1" />
  </svg>
);

const JustifyEndIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="21" y1="4" x2="21" y2="20" />
    <rect x="7" y="8" width="4" height="8" rx="1" />
    <rect x="13" y="8" width="4" height="8" rx="1" />
  </svg>
);

const JustifyBetweenIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="3" y1="4" x2="3" y2="20" />
    <line x1="21" y1="4" x2="21" y2="20" />
    <rect x="6" y="8" width="4" height="8" rx="1" />
    <rect x="14" y="8" width="4" height="8" rx="1" />
  </svg>
);

const JustifyAroundIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="4" y="8" width="4" height="8" rx="1" />
    <rect x="10" y="8" width="4" height="8" rx="1" />
    <rect x="16" y="8" width="4" height="8" rx="1" />
  </svg>
);

// Align icons
const AlignStartIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="4" y1="3" x2="20" y2="3" />
    <rect x="6" y="6" width="4" height="10" rx="1" />
    <rect x="14" y="6" width="4" height="6" rx="1" />
  </svg>
);

const AlignCenterVIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="6" y="5" width="4" height="14" rx="1" />
    <rect x="14" y="7" width="4" height="10" rx="1" />
  </svg>
);

const AlignEndIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="4" y1="21" x2="20" y2="21" />
    <rect x="6" y="8" width="4" height="10" rx="1" />
    <rect x="14" y="12" width="4" height="6" rx="1" />
  </svg>
);

const AlignStretchIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="4" y1="3" x2="20" y2="3" />
    <line x1="4" y1="21" x2="20" y2="21" />
    <rect x="6" y="6" width="4" height="12" rx="1" />
    <rect x="14" y="6" width="4" height="12" rx="1" />
  </svg>
);

interface LayoutSectionProps {
  expanded: boolean;
  onToggle: () => void;
  computedStyle: CSSStyleDeclaration;
  onApplyStyle: (property: string, value: string) => void;
  tokens: DesignTokens;
  hasChanges?: boolean;
}

export function LayoutSection({
  expanded,
  onToggle,
  computedStyle,
  onApplyStyle,
  tokens,
  hasChanges = false,
}: LayoutSectionProps) {
  const display = computedStyle.display;
  const flexDirection = computedStyle.flexDirection;
  const justifyContent = computedStyle.justifyContent;
  const alignItems = computedStyle.alignItems;
  const gap = computedStyle.gap;

  const isFlex = display === 'flex' || display === 'inline-flex';
  const isGrid = display === 'grid' || display === 'inline-grid';

  return (
    <SectionWrapper title="Layout" expanded={expanded} onToggle={onToggle} hasChanges={hasChanges}>
      {/* Display */}
      <div style={{ marginBottom: '12px' }}>
        <label style={{ fontSize: '10px', color: '#71717a', marginBottom: '4px', display: 'block' }}>
          Display
        </label>
        <ToggleGroup
          value={display}
          options={[
            { value: 'block', label: 'Block' },
            { value: 'flex', label: 'Flex' },
            { value: 'grid', label: 'Grid' },
            { value: 'inline', label: 'Inline' },
            { value: 'none', label: 'None' },
          ]}
          onChange={(value) => onApplyStyle('display', value)}
        />
      </div>

      {/* Flex-specific controls */}
      {isFlex && (
        <>
          <div style={{ marginBottom: '12px' }}>
            <label style={{ fontSize: '10px', color: '#71717a', marginBottom: '4px', display: 'block' }}>
              Direction
            </label>
            <ToggleGroup
              value={flexDirection}
              options={[
                { value: 'row', label: <ArrowRightIcon /> },
                { value: 'row-reverse', label: <ArrowLeftIcon /> },
                { value: 'column', label: <ArrowDownIcon /> },
                { value: 'column-reverse', label: <ArrowUpIcon /> },
              ]}
              onChange={(value) => onApplyStyle('flex-direction', value)}
            />
          </div>

          <div style={{ marginBottom: '12px' }}>
            <label style={{ fontSize: '10px', color: '#71717a', marginBottom: '4px', display: 'block' }}>
              Justify
            </label>
            <ToggleGroup
              value={justifyContent}
              options={[
                { value: 'flex-start', label: <JustifyStartIcon /> },
                { value: 'center', label: <JustifyCenterIcon /> },
                { value: 'flex-end', label: <JustifyEndIcon /> },
                { value: 'space-between', label: <JustifyBetweenIcon /> },
                { value: 'space-around', label: <JustifyAroundIcon /> },
              ]}
              onChange={(value) => onApplyStyle('justify-content', value)}
            />
          </div>

          <div style={{ marginBottom: '12px' }}>
            <label style={{ fontSize: '10px', color: '#71717a', marginBottom: '4px', display: 'block' }}>
              Align
            </label>
            <ToggleGroup
              value={alignItems}
              options={[
                { value: 'flex-start', label: <AlignStartIcon /> },
                { value: 'center', label: <AlignCenterVIcon /> },
                { value: 'flex-end', label: <AlignEndIcon /> },
                { value: 'stretch', label: <AlignStretchIcon /> },
              ]}
              onChange={(value) => onApplyStyle('align-items', value)}
            />
          </div>
        </>
      )}

      {/* Gap (for flex and grid) */}
      {(isFlex || isGrid) && (
        <div style={{ marginBottom: '12px' }}>
          <label style={{ fontSize: '10px', color: '#71717a', marginBottom: '4px', display: 'block' }}>
            Gap
          </label>
          <TokenDropdown
            value={gap}
            tokens={tokens.spacing}
            onChange={(value) => onApplyStyle('gap', value)}
          />
        </div>
      )}
    </SectionWrapper>
  );
}
