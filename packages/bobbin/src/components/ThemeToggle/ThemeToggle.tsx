interface ThemeToggleProps {
  theme: 'light' | 'dark' | 'system';
  onToggle: () => void;
  zIndex?: number;
}

// Sun icon for light theme
const SunIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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

// Moon icon for dark theme
const MoonIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

// Monitor icon for system theme
const MonitorIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
    <line x1="8" y1="21" x2="16" y2="21" />
    <line x1="12" y1="17" x2="12" y2="21" />
  </svg>
);

export function ThemeToggle({ theme, onToggle, zIndex = 9999 }: ThemeToggleProps) {
  const icons = {
    light: <SunIcon />,
    dark: <MoonIcon />,
    system: <MonitorIcon />,
  };

  return (
    <button
      data-bobbin="theme-toggle"
      onClick={onToggle}
      style={{
        position: 'fixed',
        bottom: '24px',
        left: '24px',
        width: '32px',
        height: '32px',
        borderRadius: '8px',
        border: '1px solid #e4e4e7',
        backgroundColor: '#fafafa',
        color: '#18181b',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '14px',
        boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
        zIndex,
      }}
      title={`Theme: ${theme}`}
    >
      {icons[theme]}
    </button>
  );
}
