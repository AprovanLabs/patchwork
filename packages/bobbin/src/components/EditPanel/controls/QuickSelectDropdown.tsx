import { useState, useMemo } from 'react';

interface QuickSelectDropdownProps {
  value: string;
  tokens: Record<string, string>;
  quickKeys: string[]; // Keys to show as quick buttons
  onChange: (value: string) => void;
  placeholder?: string;
}

export function QuickSelectDropdown({
  value,
  tokens,
  quickKeys,
  onChange,
  placeholder = 'More...',
}: QuickSelectDropdownProps) {
  const [showDropdown, setShowDropdown] = useState(false);

  // Split tokens into quick buttons and dropdown items
  const { quickItems, dropdownItems } = useMemo(() => {
    const quick: Array<{ key: string; value: string }> = [];
    const dropdown: Array<{ key: string; value: string }> = [];

    for (const [key, tokenValue] of Object.entries(tokens)) {
      if (quickKeys.includes(key)) {
        quick.push({ key, value: tokenValue });
      } else {
        dropdown.push({ key, value: tokenValue });
      }
    }

    // Sort quick items by quickKeys order
    quick.sort((a, b) => quickKeys.indexOf(a.key) - quickKeys.indexOf(b.key));

    return { quickItems: quick, dropdownItems: dropdown };
  }, [tokens, quickKeys]);

  // Check if current value matches a token
  const isSelected = (tokenValue: string) => {
    // Normalize values for comparison
    const normalizeValue = (v: string) => v.replace(/\s+/g, '').toLowerCase();
    return normalizeValue(value) === normalizeValue(tokenValue);
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '3px', flexWrap: 'wrap' }}>
      {/* Quick select buttons */}
      {quickItems.map(({ key, value: tokenValue }) => (
        <button
          key={key}
          onClick={() => onChange(tokenValue)}
          style={{
            padding: '3px 6px',
            borderRadius: '3px',
            border: '1px solid',
            borderColor: isSelected(tokenValue) ? '#18181b' : '#e4e4e7',
            backgroundColor: isSelected(tokenValue) ? '#18181b' : '#ffffff',
            color: isSelected(tokenValue) ? '#fafafa' : '#18181b',
            fontSize: '10px',
            fontFamily: 'ui-monospace, monospace',
            cursor: 'pointer',
            transition: 'all 0.1s ease',
            minWidth: '28px',
            textAlign: 'center',
          }}
          title={`${key}: ${tokenValue}`}
        >
          {key}
        </button>
      ))}

      {/* Dropdown for remaining options */}
      {dropdownItems.length > 0 && (
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setShowDropdown(!showDropdown)}
            onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
            style={{
              padding: '3px 6px',
              borderRadius: '3px',
              border: '1px solid #e4e4e7',
              backgroundColor: '#ffffff',
              color: '#71717a',
              fontSize: '10px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '2px',
            }}
          >
            <span>...</span>
          </button>

          {showDropdown && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                marginTop: '2px',
                backgroundColor: '#ffffff',
                border: '1px solid #e4e4e7',
                borderRadius: '4px',
                boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                zIndex: 10,
                maxHeight: '150px',
                overflow: 'auto',
                minWidth: '100px',
              }}
            >
              {dropdownItems.map(({ key, value: tokenValue }) => (
                <button
                  key={key}
                  onClick={() => {
                    onChange(tokenValue);
                    setShowDropdown(false);
                  }}
                  style={{
                    display: 'block',
                    width: '100%',
                    padding: '4px 8px',
                    border: 'none',
                    backgroundColor: isSelected(tokenValue) ? '#f4f4f5' : 'transparent',
                    color: '#18181b',
                    fontSize: '10px',
                    fontFamily: 'ui-monospace, monospace',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <span style={{ fontWeight: 500 }}>{key}</span>
                  <span style={{ color: '#71717a', marginLeft: '4px' }}>{tokenValue}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
