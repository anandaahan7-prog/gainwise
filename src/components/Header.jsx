const NEXT = { system: 'light', light: 'dark', dark: 'system' };
const ICON = { system: '◐', light: '☀', dark: '☾' };

export default function Header({ theme, setTheme, onHome }) {
  return (
    <header className="app-header no-print">
      <div className="container">
        <button className="brand" onClick={onHome} disabled={!onHome} style={{ cursor: onHome ? 'pointer' : 'default' }}>
          <span className="brand-mark">₹</span>
          <span>GainWise</span>
        </button>
        <div className="header-spacer" />
        <span className="privacy-pill" title="Your file is processed by a Python engine running inside this browser tab">
          🔒 <span className="long">Your data never leaves this device</span>
          <span className="sr-only">Private</span>
        </span>
        <button
          className="icon-btn"
          onClick={() => setTheme(NEXT[theme])}
          title={`Theme: ${theme} (click to change)`}
          aria-label={`Theme: ${theme}`}
        >
          {ICON[theme]}
        </button>
      </div>
    </header>
  );
}
