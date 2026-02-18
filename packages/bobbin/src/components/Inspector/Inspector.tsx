import { useState, useMemo } from 'react';
import type { SelectedElement } from '../../types';

interface InspectorProps {
  selectedElement: SelectedElement;
  onSelectElement: (el: HTMLElement) => void;
  onClose?: () => void;
  zIndex?: number;
}

export function Inspector({
  selectedElement,
  onSelectElement,
  zIndex = 9999,
}: InspectorProps) {
  const [activeTab, setActiveTab] = useState<'tree' | 'styles' | 'attributes'>('attributes');
  const [isMinimized, setIsMinimized] = useState(false);

  const computedStyles = useMemo(() => {
    const computed = window.getComputedStyle(selectedElement.element);
    const styles: Record<string, string> = {};
    
    // Get commonly-inspected properties
    const properties = [
      'display', 'position', 'width', 'height', 'margin', 'padding',
      'border', 'background', 'color', 'font-family', 'font-size',
      'font-weight', 'line-height', 'text-align', 'flex', 'grid',
    ];
    
    for (const prop of properties) {
      styles[prop] = computed.getPropertyValue(prop);
    }
    
    return styles;
  }, [selectedElement.element]);

  const attributes = useMemo(() => {
    const attrs: Record<string, string> = {};
    const el = selectedElement.element;
    for (const attr of el.attributes) {
      // Skip 'contenteditable'
      if (attr.name.toLowerCase() === 'contenteditable') {
        continue;
      }
      attrs[attr.name] = attr.value;
    }
    return attrs;
  }, [selectedElement.element]);

  // Build DOM tree path
  const domPath = useMemo(() => {
    const path: HTMLElement[] = [];
    let el: HTMLElement | null = selectedElement.element;
    while (el && el !== document.body) {
      path.unshift(el);
      el = el.parentElement;
    }
    return path;
  }, [selectedElement.element]);

  return (
    <div
      data-bobbin="inspector"
      style={{
        position: 'fixed',
        bottom: '16px',
        left: '16px',
        width: isMinimized ? 'auto' : '320px',
        maxHeight: isMinimized ? 'auto' : '260px',
        backgroundColor: '#fafafa',
        borderRadius: '8px',
        border: '1px solid #e4e4e7',
        boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
        zIndex,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        color: '#18181b',
        fontFamily: 'ui-monospace, SFMono-Regular, monospace',
        fontSize: '11px',
      }}
    >
      {/* Header with minimize/close controls */}
      {isMinimized ? (
        <div
          style={{
            padding: '6px 10px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            cursor: 'pointer',
            backgroundColor: '#ffffff',
          }}
          onClick={() => setIsMinimized(false)}
        >
          <span style={{ fontSize: '10px', color: '#71717a' }}>Inspector</span>
        </div>
      ) : (
        <>
          {/* Tabs with close button */}
          <div style={{ display: 'flex', borderBottom: '1px solid #e4e4e7', backgroundColor: '#ffffff' }}>
            {(['styles', 'attributes'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  flex: 1,
                  padding: '6px 8px',
                  border: 'none',
                  borderBottom: activeTab === tab ? '2px solid #18181b' : '2px solid transparent',
                  backgroundColor: 'transparent',
                  color: activeTab === tab ? '#18181b' : '#71717a',
                  cursor: 'pointer',
                  textTransform: 'capitalize',
                  fontSize: '11px',
                  fontWeight: activeTab === tab ? 500 : 400,
                }}
              >
                {tab}
              </button>
            ))}
            <div style={{ display: 'flex', alignItems: 'center', gap: '2px', padding: '0 4px' }}>
              <button
                onClick={() => setIsMinimized(true)}
                style={{
                  width: '18px',
                  height: '18px',
                  borderRadius: '3px',
                  border: 'none',
                  backgroundColor: 'transparent',
                  color: '#71717a',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '14px',
                }}
                title="Minimize"
              >
                −
              </button>
            </div>
          </div>

          {/* Content */}
          <div style={{ flex: 1, overflow: 'auto', padding: '6px' }}>
            {activeTab === 'tree' && (
              <div>
                {domPath.map((el, i) => (
                  <div
                    key={i}
                    onClick={() => onSelectElement(el)}
                    style={{
                      padding: '3px 6px',
                      paddingLeft: `${i * 10 + 6}px`,
                      cursor: 'pointer',
                      backgroundColor: el === selectedElement.element ? '#18181b' : 'transparent',
                      color: el === selectedElement.element ? '#fafafa' : '#18181b',
                      borderRadius: '3px',
                      marginBottom: '1px',
                    }}
                  >
                    <span style={{ color: el === selectedElement.element ? '#a1a1aa' : '#52525b' }}>
                      {el.tagName.toLowerCase()}
                    </span>
                    {el.id && (
                      <span style={{ color: el === selectedElement.element ? '#d4d4d8' : '#71717a' }}>
                        #{el.id}
                      </span>
                    )}
                    {el.classList.length > 0 && (
                      <span style={{ color: el === selectedElement.element ? '#a1a1aa' : '#a1a1aa' }}>
                        .{Array.from(el.classList).slice(0, 2).join('.')}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'styles' && (
              <div>
                {Object.entries(computedStyles).map(([prop, value]) => (
                  <div
                    key={prop}
                    style={{
                      display: 'flex',
                      padding: '2px 0',
                      borderBottom: '1px solid #f4f4f5',
                    }}
                  >
                    <span style={{ color: '#52525b', width: '100px' }}>{prop}:</span>
                    <span style={{ color: '#18181b', flex: 1 }}>{value}</span>
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'attributes' && (
              <div>
                {Object.entries(attributes).map(([name, value]) => (
                  <div
                    key={name}
                    style={{
                      display: 'flex',
                      padding: '2px 0',
                      borderBottom: '1px solid #f4f4f5',
                    }}
                  >
                    <span style={{ color: '#71717a', width: '80px' }}>{name}</span>
                    <span style={{ color: '#18181b' }}>"{value}"</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
