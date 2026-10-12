import { inr, inrCompact } from '../lib/format';
import { fyLabel } from '../lib/dates';

// The three screens, shown as summary cards: each one is both a tab and its headline number.
export default function NavCards({ view, setView, reportTax, worth, invested, saveTotal, navLoading }) {
  const cards = [
    {
      id: 'report',
      label: 'Tax report',
      value: inr(reportTax.total),
      sub: `you owe for ${fyLabel(reportTax.fy)}`,
    },
    {
      id: 'portfolio',
      label: 'Portfolio',
      value: worth != null ? inrCompact(worth) : inrCompact(invested),
      sub: worth != null ? 'worth today' : navLoading ? 'loading live prices…' : 'invested (no prices yet)',
    },
    {
      id: 'save',
      label: 'Save tax',
      value: saveTotal != null ? inr(saveTotal) : '…',
      sub: saveTotal == null ? 'finding ideas…' : saveTotal > 0 ? 'of savings found this year' : 'nothing to optimise now',
      accent: true,
    },
  ];

  return (
    <nav className="navcards no-print" role="tablist" aria-label="Screens">
      {cards.map((c) => (
        <button
          key={c.id}
          role="tab"
          aria-selected={view === c.id}
          className={`navcard ${view === c.id ? 'active' : ''} ${c.accent ? 'accent' : ''}`}
          onClick={() => setView(c.id)}
        >
          <span className="navcard-label">{c.label}</span>
          <span className="navcard-value">{c.value}</span>
          <span className="navcard-sub">{c.sub}</span>
        </button>
      ))}
    </nav>
  );
}
