import { useState, useMemo } from 'react';
import type { SelectedElement, BobbinActions, DesignTokens, Change, StyleChange, Annotation } from '../../types';
import { LayoutSection } from './sections/LayoutSection';
import { SpacingSection } from './sections/SpacingSection';
import { SizeSection } from './sections/SizeSection';
import { TypographySection } from './sections/TypographySection';
import { BackgroundSection } from './sections/BackgroundSection';
import { EffectsSection } from './sections/EffectsSection';
import { AnnotationSection } from './sections/AnnotationSection';

// Theme icons
const SunIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="5" />
    <line x1="12" y1="1" x2="12" y2="3" />
    <line x1="12" y1="21" x2="12" y2="23" />
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
    <line x1="1" y1="12" x2="3" y2="12" />
    <line x1="21" y1="12" x2="23" y2="12" />
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
  </svg>
);

const MoonIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

const MonitorIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
    <line x1="8" y1="21" x2="16" y2="21" />
    <line x1="12" y1="17" x2="12" y2="21" />
  </svg>
);

// Spacing visualization icon
const SpacingIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <rect x="7" y="7" width="10" height="10" rx="1" />
  </svg>
);

// Reset icon
const ResetIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
  </svg>
);

interface EditPanelProps {
  selectedElement: SelectedElement;
  actions: BobbinActions;
  tokens: DesignTokens;
  onClose: () => void;
  showMarginPadding: boolean;
  zIndex?: number;
  theme: 'light' | 'dark' | 'system';
  onThemeToggle: () => void;
  changes: Change[];
  annotations: Annotation[];
  onReset: () => void;
}

type Section = 'layout' | 'spacing' | 'size' | 'typography' | 'background' | 'effects' | 'annotation';

// Map CSS properties to sections
const propertySectionMap: Record<string, Section> = {
  'display': 'layout',
  'flex-direction': 'layout',
  'justify-content': 'layout',
  'align-items': 'layout',
  'flex-wrap': 'layout',
  'gap': 'layout',
  'margin-top': 'spacing',
  'margin-right': 'spacing',
  'margin-bottom': 'spacing',
  'margin-left': 'spacing',
  'padding-top': 'spacing',
  'padding-right': 'spacing',
  'padding-bottom': 'spacing',
  'padding-left': 'spacing',
  'width': 'size',
  'height': 'size',
  'min-width': 'size',
  'min-height': 'size',
  'max-width': 'size',
  'max-height': 'size',
  'font-size': 'typography',
  'font-weight': 'typography',
  'font-family': 'typography',
  'line-height': 'typography',
  'letter-spacing': 'typography',
  'text-align': 'typography',
  'color': 'typography',
  'background-color': 'background',
  'background': 'background',
  'border-radius': 'effects',
  'box-shadow': 'effects',
  'border': 'effects',
  'border-width': 'effects',
  'opacity': 'effects',
};

export function EditPanel({
  selectedElement,
  actions,
  tokens,
  onClose,
  showMarginPadding,
  zIndex = 9999,
  theme,
  onThemeToggle,
  changes,
  annotations,
  onReset,
}: EditPanelProps) {
  const [expandedSections, setExpandedSections] = useState<Set<Section>>(
    new Set(['annotation', 'layout', 'spacing', 'typography'])
  );

  // Calculate which sections have changes for the current element
  const changedSections = useMemo(() => {
    const sections = new Set<Section>();
    const elementChanges = changes.filter(
      (c) => c.target.path === selectedElement.path && c.type === 'style'
    ) as StyleChange[];
    
    for (const change of elementChanges) {
      const property = change.after.property;
      const section = propertySectionMap[property];
      if (section) {
        sections.add(section);
      }
    }
    return sections;
  }, [changes, selectedElement.path]);

  // Get changed properties for spacing section highlighting
  const changedSpacingProps = useMemo(() => {
    const props: Record<string, boolean> = {};
    const elementChanges = changes.filter(
      (c) => c.target.path === selectedElement.path && c.type === 'style'
    ) as StyleChange[];
    
    for (const change of elementChanges) {
      const prop = change.after.property;
      if (prop.startsWith('margin-') || prop.startsWith('padding-')) {
        props[prop] = true;
      }
    }
    return props;
  }, [changes, selectedElement.path]);

  const toggleSection = (section: Section) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  const computedStyle = window.getComputedStyle(selectedElement.element);

  const themeIcons = {
    light: <SunIcon />,
    dark: <MoonIcon />,
    system: <MonitorIcon />,
  };

  const hasAnyChanges = changes.some((c) => c.target.path === selectedElement.path);

  // ShadCN-style: white background, subtle borders, clean typography
  return (
    <div
      data-bobbin="edit-panel"
      style={{
        position: 'fixed',
        top: '16px',
        right: '16px',
        width: '280px',
        maxHeight: 'calc(100vh - 32px)',
        backgroundColor: '#fafafa',
        borderRadius: '8px',
        border: '1px solid #e4e4e7',
        boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
        zIndex,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        color: '#18181b',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '13px',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '10px 12px',
          borderBottom: '1px solid #e4e4e7',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: '#ffffff',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontWeight: 500, fontSize: '12px' }}>{selectedElement.tagName}</span>
          {selectedElement.id && (
            <span style={{ color: '#71717a', fontSize: '11px' }}>#{selectedElement.id}</span>
          )}
          {selectedElement.classList.length > 0 && (
            <span style={{ color: '#a1a1aa', fontSize: '10px' }}>
              .{selectedElement.classList.slice(0, 2).join('.')}
              {selectedElement.classList.length > 2 && '...'}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '4px' }}>
          {/* Theme toggle */}
          <button
            onClick={onThemeToggle}
            style={{
              padding: '4px 6px',
              borderRadius: '4px',
              border: '1px solid #e4e4e7',
              backgroundColor: '#ffffff',
              cursor: 'pointer',
              fontSize: '12px',
            }}
            title={`Theme: ${theme}`}
          >
            {themeIcons[theme]}
          </button>
          {/* Toggle margin/padding view */}
          <button
            onClick={actions.toggleMarginPadding}
            style={{
              padding: '4px 6px',
              borderRadius: '4px',
              border: '1px solid #e4e4e7',
              backgroundColor: showMarginPadding ? '#18181b' : '#ffffff',
              color: showMarginPadding ? '#fafafa' : '#71717a',
              cursor: 'pointer',
              fontSize: '10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            title="Toggle spacing visualization"
          >
            <SpacingIcon />
          </button>
          {/* Reset button */}
          {hasAnyChanges && (
            <button
              onClick={onReset}
              style={{
                padding: '4px 6px',
                borderRadius: '4px',
                border: '1px solid #e4e4e7',
                backgroundColor: '#ffffff',
                color: '#71717a',
                cursor: 'pointer',
                fontSize: '10px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              title="Reset all changes"
            >
              <ResetIcon />
            </button>
          )}
          {/* Close */}
          <button
            onClick={onClose}
            style={{
              width: '22px',
              height: '22px',
              borderRadius: '4px',
              border: '1px solid #e4e4e7',
              backgroundColor: '#ffffff',
              color: '#71717a',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '12px',
            }}
          >
            ×
          </button>
        </div>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '8px 0' }}>
        {/* Annotation section moved to top and default open */}
        <AnnotationSection
          expanded={expandedSections.has('annotation')}
          onToggle={() => toggleSection('annotation')}
          onAnnotate={actions.annotate}
          existingAnnotation={
            annotations.find((a) => a.elementPath === selectedElement.path)?.content
          }
          hasChanges={annotations.some((a) => a.elementPath === selectedElement.path)}
        />
        
        <LayoutSection
          expanded={expandedSections.has('layout')}
          onToggle={() => toggleSection('layout')}
          computedStyle={computedStyle}
          onApplyStyle={actions.applyStyle}
          tokens={tokens}
          hasChanges={changedSections.has('layout')}
        />
        
        <SpacingSection
          expanded={expandedSections.has('spacing')}
          onToggle={() => toggleSection('spacing')}
          computedStyle={computedStyle}
          onApplyStyle={actions.applyStyle}
          tokens={tokens}
          hasChanges={changedSections.has('spacing')}
          changedProps={changedSpacingProps}
        />
        
        <SizeSection
          expanded={expandedSections.has('size')}
          onToggle={() => toggleSection('size')}
          computedStyle={computedStyle}
          onApplyStyle={actions.applyStyle}
          tokens={tokens}
          hasChanges={changedSections.has('size')}
        />
        
        <TypographySection
          expanded={expandedSections.has('typography')}
          onToggle={() => toggleSection('typography')}
          computedStyle={computedStyle}
          onApplyStyle={actions.applyStyle}
          tokens={tokens}
          hasChanges={changedSections.has('typography')}
        />
        
        <BackgroundSection
          expanded={expandedSections.has('background')}
          onToggle={() => toggleSection('background')}
          computedStyle={computedStyle}
          onApplyStyle={actions.applyStyle}
          tokens={tokens}
          hasChanges={changedSections.has('background')}
        />
        
        <EffectsSection
          expanded={expandedSections.has('effects')}
          onToggle={() => toggleSection('effects')}
          computedStyle={computedStyle}
          onApplyStyle={actions.applyStyle}
          tokens={tokens}
          hasChanges={changedSections.has('effects')}
        />
      </div>
    </div>
  );
}
