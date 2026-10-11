// Small dependency-free charts. Colors come from the --series-N tokens (validated categorical palette).
import { useState } from 'react';
import { inr, inrCompact, shortFund } from '../lib/format';
import { formatMonth } from '../lib/dates';

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

/** Short- vs long-term gain per fund; bars grow left for losses, right for gains. */
export function GainsByFund({ rows }) {
  const tip = useTip();
  if (!rows.length) return <div className="empty">No realized gains in this year.</div>;
  const max = Math.max(...rows.flatMap((r) => [Math.abs(r.st), Math.abs(r.lt)]), 1);
  const hasNeg = rows.some((r) => r.st < 0 || r.lt < 0);
  const zero = hasNeg ? 50 : 0;
  const span = hasNeg ? 50 : 100;
  const bar = (v, cls) => {
    if (Math.abs(v) < 0.5) return null;
    const w = (Math.abs(v) / max) * span;
    return <div className={`hbar ${cls} ${v >= 0 ? 'right' : 'left'}`} style={{ left: `${v >= 0 ? zero : zero - w}%`, width: `${Math.max(w, 0.6)}%` }} />;
  };
  return (
    <>
      <Legend items={[{ label: 'Short-term', color: 'var(--series-1)' }, { label: 'Long-term', color: 'var(--series-2)' }]} />
      <div className="hbar-list">
        {rows.map((r) => (
          <div className="hbar-row" key={r.fund}>
            <span className="hbar-label" title={r.fund}>{shortFund(r.fund)}</span>
            <div
              className="hbar-track"
              onMouseMove={(e) =>
                tip.show(e, <TipRows title={shortFund(r.fund)} rows={[
                  { label: 'Short-term', value: inr(r.st), color: 'var(--series-1)' },
                  { label: 'Long-term', value: inr(r.lt), color: 'var(--series-2)' },
                ]} />)
              }
              onMouseLeave={tip.hide}
            >
              <div className="hbar-axis" style={{ left: `${zero}%` }} />
              {bar(r.st, 's1')}
              {bar(r.lt, 's2')}
            </div>
          </div>
        ))}
      </div>
      {tip.node}
    </>
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

/** Monthly money in vs money out (two series, side-by-side columns). */
export function MonthlyFlow({ months }) {
  const tip = useTip();
  if (!months.length) return <div className="empty">No transactions.</div>;
  const W = 720;
  const H = 200;
  const padL = 44;
  const padB = 22;
  const max = Math.max(...months.flatMap((m) => [m.in, m.out]), 1);
  const nice = niceMax(max);
  const band = (W - padL) / months.length;
  const bw = Math.min(10, Math.max(2, (band - 4) / 2));
  const y = (v) => (H - padB) * (1 - v / nice);
  const ticks = [0, nice / 2, nice];
  const labelEvery = Math.ceil(months.length / 8);
  const col = (x, v, color) => {
    const h = (H - padB) - y(v);
    if (h <= 0) return null;
    const r = Math.min(3, bw / 2, h);
    return <path d={`M${x},${H - padB} v${-(h - r)} q0,${-r} ${r},${-r} h${bw - 2 * r} q${r},0 ${r},${r} v${h - r} z`} fill={color} />;
  };
  return (
    <>
      <Legend items={[{ label: 'Invested', color: 'var(--series-1)' }, { label: 'Redeemed', color: 'var(--series-2)' }]} />
      <svg className="chart-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Monthly invested and redeemed amounts">
        {ticks.map((t) => (
          <g key={t}>
            <line className="gridline" x1={padL} x2={W} y1={y(t)} y2={y(t)} />
            <text x={padL - 6} y={y(t) + 4} textAnchor="end">{inrCompact(t)}</text>
          </g>
        ))}
        {months.map((m, i) => {
          const x0 = padL + i * band + (band - 2 * bw - 2) / 2;
          return (
            <g key={m.key}>
              {col(x0, m.in, 'var(--series-1)')}
              {col(x0 + bw + 2, m.out, 'var(--series-2)')}
              {i % labelEvery === 0 && <text x={padL + i * band + band / 2} y={H - 6} textAnchor="middle">{formatMonth(m.key)}</text>}
              <rect
                x={padL + i * band}
                y={0}
                width={band}
                height={H - padB}
                fill="transparent"
                onMouseMove={(e) => tip.show(e, <TipRows title={formatMonth(m.key)} rows={[
                  { label: 'Invested', value: inr(m.in), color: 'var(--series-1)' },
                  { label: 'Redeemed', value: inr(m.out), color: 'var(--series-2)' },
                ]} />)}
                onMouseLeave={tip.hide}
              />
            </g>
          );
        })}
      </svg>
      {tip.node}
    </>
  );
}

function niceMax(v) {
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}
