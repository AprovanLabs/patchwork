interface TokenDropdownProps {
  value: string;
  tokens: Record<string, string>;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function TokenDropdown({ value, tokens, onChange, placeholder = 'Select...' }: TokenDropdownProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: '100%',
        padding: '4px 8px',
        borderRadius: '4px',
        border: '1px solid #e4e4e7',
        backgroundColor: '#ffffff',
        color: '#18181b',
        fontSize: '11px',
        cursor: 'pointer',
        outline: 'none',
      }}
    >
      <option value="">{placeholder}</option>
      {Object.entries(tokens).map(([key, tokenValue]) => (
        <option key={key} value={tokenValue}>
          {key}: {tokenValue}
        </option>
      ))}
    </select>
  );
}
