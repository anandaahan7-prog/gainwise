// Small dependency-free charts. Colors come from the --series-N tokens (validated categorical palette).
import { useState } from 'react';
import { inr } from '../lib/format';

function useTip() {
  const [tip, setTip] = useState(null);
  const show = (e, content) => setTip({ x: e.clientX, y: e.clientY, content });
  const hide = () => setTip(null);
  const node = tip && (
    <div className="chart-tip" style={{ left: Math.min(tip.x + 14, window.innerWidth - 220), top: tip.y + 14 }}>
      {tip.content}
    </div>
  );
  return { show, hide, node };
}

const TipRows = ({ title, rows }) => (
  <>
    <div className="tip-title">{title}</div>
    {rows.map((r) => (
      <div className="tip-row" key={r.label}>
        <span>
          {r.color && <i className="swatch" style={{ background: r.color }} />}
          {r.label}
        </span>
        <strong className="num">{r.value}</strong>
      </div>
    ))}
  </>
);

export function Legend({ items }) {
  return (
    <div className="legend">
      {items.map((i) => (
        <span className="legend-item" key={i.label}>
          <i className="swatch" style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

/** One stacked bar splitting a total into named parts (fixed color per part). */
export function StackBar({ parts, format = inr }) {
  const tip = useTip();
  const visible = parts.filter((p) => p.value > 0.5);
  const total = visible.reduce((a, p) => a + p.value, 0);
  if (!total) return <div className="empty">Nothing to show.</div>;
  return (
    <>
      <div className="stackbar" role="img" aria-label={visible.map((p) => `${p.label} ${format(p.value)}`).join(', ')}>
        {visible.map((p) => (
          <div
            key={p.label}
            style={{ width: `${(p.value / total) * 100}%`, background: p.color }}
            onMouseMove={(e) => tip.show(e, <TipRows title={p.label} rows={[{ label: 'Amount', value: format(p.value) }, { label: 'Share', value: `${((p.value / total) * 100).toFixed(1)}%` }]} />)}
            onMouseLeave={tip.hide}
          />
        ))}
      </div>
      <div className="legend" style={{ marginTop: 12, marginBottom: 0 }}>
        {visible.map((p) => (
          <span className="legend-item" key={p.label}>
            <i className="swatch" style={{ background: p.color }} />
            {p.label} <strong className="num">{format(p.value)}</strong>
          </span>
        ))}
      </div>
      {tip.node}
    </>
  );
}
