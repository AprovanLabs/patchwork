import { createPortal } from 'react-dom';
import type { BobbinProps } from './types';
import { useBobbin } from './core/useBobbin';
import { Pill } from './components/Pill/Pill';
import { SelectionOverlay } from './components/Overlay/SelectionOverlay';
import { ControlHandles } from './components/Overlay/ControlHandles';
import { MarginPaddingOverlay } from './components/Overlay/MarginPaddingOverlay';
import { EditPanel } from './components/EditPanel/EditPanel';
import { Inspector } from './components/Inspector/Inspector';

export interface BobbinComponentProps extends BobbinProps {
  /** Show inspector panel */
  showInspector?: boolean;
}

export function Bobbin(props: BobbinComponentProps) {
  const { showInspector = false, ...bobbinProps } = props;
  
  const bobbin = useBobbin(bobbinProps);
  const { zIndex = 9999, pillContainer } = bobbinProps;

  return createPortal(
    <div data-bobbin="root">
      {/* Floating pill */}
      <Pill
        state={bobbin}
        actions={bobbin}
        position={bobbinProps.position}
        container={pillContainer ?? bobbinProps.container}
        zIndex={zIndex}
      />

      {/* Selection overlays */}
      {bobbin.isActive && (
        <SelectionOverlay
          hoveredElement={bobbin.hoveredElement}
          selectedElement={bobbin.selectedElement}
          zIndex={zIndex - 10}
        />
      )}

      {/* Control handles */}
      {bobbin.selectedElement && (
        <ControlHandles
          selectedElement={bobbin.selectedElement}
          actions={bobbin}
          clipboard={bobbin.clipboard}
          zIndex={zIndex}
        />
      )}

      {/* Margin/padding overlay */}
      {bobbin.selectedElement && bobbin.showMarginPadding && (
        <MarginPaddingOverlay
          selectedElement={bobbin.selectedElement}
          zIndex={zIndex - 5}
        />
      )}

      {/* Edit panel */}
      {bobbin.selectedElement && bobbin.activePanel === 'style' && (
        <EditPanel
          selectedElement={bobbin.selectedElement}
          actions={bobbin}
          tokens={bobbin.tokens}
          onClose={bobbin.clearSelection}
          showMarginPadding={bobbin.showMarginPadding}
          zIndex={zIndex}
          theme={bobbin.theme}
          onThemeToggle={bobbin.toggleTheme}
          changes={bobbin.changes}
          annotations={bobbin.annotations}
          onReset={bobbin.resetChanges}
        />
      )}

      {/* Inspector */}
      {bobbin.selectedElement && (showInspector || bobbin.activePanel === 'inspector') && (
        <Inspector
          selectedElement={bobbin.selectedElement}
          onSelectElement={(el) => bobbin.selectElement(el)}
          onClose={() => bobbin.setActivePanel(null)}
          zIndex={zIndex}
        />
      )}
    </div>,
    document.body
  );
}
