const NEXT = { system: 'light', light: 'dark', dark: 'system' };
const ICON = { system: '◐', light: '☀', dark: '☾' };

export default function Header({ theme, setTheme, onHome, onPrivacy, requestCount }) {
  return (
    <header className="app-header no-print">
      <div className="container">
        <button className="brand" onClick={onHome} disabled={!onHome} style={{ cursor: onHome ? 'pointer' : 'default' }}>
          <span className="brand-mark">₹</span>
          <span>GainWise</span>
        </button>
        <div className="header-spacer" />
        <button
          className="privacy-pill"
          onClick={onPrivacy}
          title="See every network request this page has made"
        >
          🔒 <span className="long">Your data never leaves this device</span>
          <span className="sr-only">Privacy log</span>
          {requestCount > 0 && <span className="pill-count">{requestCount}</span>}
        </button>
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
