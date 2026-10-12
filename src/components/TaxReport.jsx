import { Fragment, useMemo, useState } from 'react';
import { groupSales } from '../lib/portfolio';
import { buildInsights } from '../lib/insights';
import { inr, units, signClass, shortFund } from '../lib/format';
import { fyLabel, formatDate } from '../lib/dates';
import { HEADS } from '../lib/tax';
import TaxTable from './TaxTable';

const NOTE_ICON = { good: '💡', info: 'ℹ️', warn: '⚠️', bad: '🔺' };

// Gains → losses used → tax-free → taxable, then tax. Shows the whole computation in one picture.
function Waterfall({ tax }) {
  const gains = tax.rows.reduce((a, r) => a + r.gains, 0);
  const bfUsed = tax.broughtForward?.used ?? 0;
  const losses = tax.rows.reduce((a, r) => a + r.losses, 0) - tax.carryForward.st - tax.carryForward.lt + bfUsed;
  const exempt = tax.rows.reduce((a, r) => a + r.exempt, 0);
  const taxable = tax.rows.reduce((a, r) => a + r.taxable, 0);
  if (gains < 1) return null;
  const pct = (v) => `${(v / gains) * 100}%`;
  const steps = [
    { label: 'Gains', value: gains, from: 0, to: gains, cls: 'wf-gain' },
    { label: bfUsed >= 1 ? 'Losses set off (incl. earlier years)' : 'Losses set off', value: -losses, from: gains - losses, to: gains, cls: 'wf-loss', hide: losses < 1 },
    { label: 'Tax-free (₹1.25L exemption)', value: -exempt, from: taxable, to: gains - losses, cls: 'wf-exempt', hide: exempt < 1 },
    { label: 'Taxable', value: taxable, from: 0, to: taxable, cls: 'wf-taxable' },
  ].filter((s) => !s.hide);
  const rates = tax.rows.filter((r) => r.taxable > 0.5).map((r) => `${+(r.rate * 100).toFixed(1)}%`);

  return (
    <div className="waterfall" role="img" aria-label={`Gains ${inr(gains)}, taxable ${inr(taxable)}, tax ${inr(tax.total)}`}>
      {steps.map((s) => (
        <div className="wf-row" key={s.label}>
          <span className="wf-label">{s.label}</span>
          <div className="wf-track">
            <div className={`wf-bar ${s.cls}`} style={{ left: pct(s.from), width: `max(${pct(s.to - s.from)}, 3px)` }} />
          </div>
          <span className={`wf-value num ${s.cls === 'wf-loss' ? 'neg' : ''}`}>{s.value < 0 ? `−${inr(-s.value)}` : inr(s.value)}</span>
        </div>
      ))}
      <div className="wf-tax">
        <span>
          Taxable {inr(taxable)} × {rates.length ? [...new Set(rates)].join(' / ') : '0%'}
        </span>
        <span className="num">= {inr(tax.baseTax)}</span>
        <span>+ 4% cess</span>
        <span className="num">{inr(tax.cess)}</span>
        <strong className="num">= {inr(tax.total)}</strong>
      </div>
    </div>
  );
}

// Losses carried forward from earlier ITRs (Sec 74): short-term can offset any gain, long-term only long-term
function BroughtForward({ bf, setBf, tax }) {
  const [open, setOpen] = useState(bf.st > 0 || bf.lt > 0);
  const set = (k) => (e) => setBf({ ...bf, [k]: Math.max(0, parseFloat(e.target.value) || 0) });
  const info = tax.broughtForward;
  if (!open) {
    return (
      <button className="link-btn small" onClick={() => setOpen(true)}>
        + Add losses brought forward from earlier years
      </button>
    );
  }
  return (
    <div className="bf-form">
      <div>
        <strong>Losses brought forward</strong>
        <p className="muted small">From the "losses to carry forward" in your previous ITRs (up to 8 years). Kept in this tab only.</p>
      </div>
      <label className="field">
        Short-term (₹)
        <input className="input" type="number" min="0" step="1" value={bf.st || ''} placeholder="0" onChange={set('st')} />
      </label>
      <label className="field">
        Long-term (₹)
        <input className="input" type="number" min="0" step="1" value={bf.lt || ''} placeholder="0" onChange={set('lt')} />
      </label>
      {info && (info.st > 0 || info.lt > 0) && (
        <p className="small">
          Used this year: <strong className="num">{inr(info.used)}</strong>
          {info.left.st + info.left.lt >= 1 && <> · still to carry forward: <strong className="num">{inr(info.left.st + info.left.lt)}</strong></>}
        </p>
      )}
    </div>
  );
}

function FundSales({ sales }) {
  const [open, setOpen] = useState({});
  return (
    <div className="table-wrap">
      <table className="sub-table">
        <thead>
          <tr>
            <th>Sold on</th>
            <th className="r">Units</th>
            <th className="r">Cost</th>
            <th className="r">Sale value</th>
            <th className="r">Short-term</th>
            <th className="r">Long-term</th>
          </tr>
        </thead>
        <tbody>
          {sales.map((s) => (
            <Fragment key={s.id}>
              <tr className={`clickable ${s.simulated ? 'sim' : ''}`} onClick={() => setOpen((o) => ({ ...o, [s.id]: !o[s.id] }))}>
                <td className="nowrap">
                  <span className={`caret ${open[s.id] ? 'open' : ''}`}>▶</span>
                  {formatDate(s.sellDate)} {s.simulated && <span className="badge sim">what-if</span>}
                </td>
                <td className="r">{units(s.units)}</td>
                <td className="r">{inr(s.cost)}</td>
                <td className="r">{inr(s.proceeds)}</td>
                <td className={`r ${signClass(s.st)}`}>{Math.abs(s.st) < 0.5 ? '—' : inr(s.st)}</td>
                <td className={`r ${signClass(s.lt)}`}>{Math.abs(s.lt) < 0.5 ? '—' : inr(s.lt)}</td>
              </tr>
              {open[s.id] &&
                s.lots.map((l, i) => (
                  <tr className="lot" key={i}>
                    <td colSpan={2}>
                      Bought {formatDate(l.buyDate)} @ {inr(l.buyNav, { paise: true })}
                      <div className="muted small">
                        {HEADS[l.head].label} · {HEADS[l.head].section}
                        {l.deemed && ' · always slab (Sec 50AA)'}
                        {l.indexedCost != null && ` · indexed cost ${inr(l.indexedCost)}`}
                        {l.grandfatheredCost != null && ` · grandfathered cost ${inr(l.grandfatheredCost)}`}
                        {l.needsFmv && ' · 2018 NAV not loaded yet'}
                      </div>
                    </td>
                    <td className="r">{inr(l.cost)}</td>
                    <td className="r">{inr(l.proceeds)}</td>
                    <td className={`r ${signClass(l.gain)}`}>{l.term === 'ST' ? inr(l.gain) : ''}</td>
                    <td className={`r ${signClass(l.gain)}`}>{l.term === 'LT' ? inr(l.gain) : ''}</td>
                  </tr>
                ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function TaxReport({ model, tax, fy, setFy, warnings, goTo, bf, setBf }) {
  const [showTable, setShowTable] = useState(false);
  const [openFund, setOpenFund] = useState(null);
  const notes = useMemo(() => buildInsights(model, tax), [model, tax]);

  const funds = useMemo(() => {
    const sales = groupSales(tax.records);
    const map = new Map();
    for (const s of sales) {
      const f = map.get(s.fund) ?? { fund: s.fund, assetClass: s.assetClass, st: 0, lt: 0, sales: [] };
      f.st += s.st;
      f.lt += s.lt;
      f.sales.push(s);
      map.set(s.fund, f);
    }
    return [...map.values()].sort((a, b) => Math.abs(b.st + b.lt) - Math.abs(a.st + a.lt));
  }, [tax]);
  const maxAbs = Math.max(1, ...funds.flatMap((f) => [Math.abs(f.st), Math.abs(f.lt)]));
  const hasNeg = funds.some((f) => f.st < 0 || f.lt < 0);
  const net = tax.stcg + tax.ltcg;
  const sims = tax.records.some((r) => r.simulated);

  return (
    <div className="stack">
      <section className="hero-panel">
        <div className="hero-left">
          <label className="field">
            Financial year
            <select className="select" value={fy} onChange={(e) => setFy(Number(e.target.value))}>
              {model.fys.map((y) => (
                <option key={y} value={y}>
                  {fyLabel(y)}
                  {y === model.currentFy ? ' (current)' : ''}
                </option>
              ))}
            </select>
          </label>
          <div className="hero-figure">
            <span className="hero-kicker">You owe</span>
            <span className="hero-number num">{inr(tax.total)}</span>
            <span className="hero-sub">
              {tax.records.length
                ? `on ${inr(net)} of net gains${net > 0 ? ` · ${((tax.total / net) * 100).toFixed(1)}% effective` : ''} · incl. 4% cess`
                : `No sales in ${fyLabel(fy)}, so nothing to pay.`}
              {sims && <span className="badge sim" style={{ marginLeft: 8 }}>includes what-ifs</span>}
            </span>
          </div>
        </div>
        <div className="hero-right">
          <div className="mini-stat">
            <span>Short-term</span>
            <strong className={`num ${signClass(tax.stcg)}`}>{inr(tax.stcg)}</strong>
          </div>
          <div className="mini-stat">
            <span>Long-term</span>
            <strong className={`num ${signClass(tax.ltcg)}`}>{inr(tax.ltcg)}</strong>
          </div>
          <div className="mini-stat">
            <span>Exemption used</span>
            <strong className="num">
              {inr(tax.exemptionUsed)} <small className="muted">/ {inr(tax.limit)}</small>
            </strong>
          </div>
        </div>
      </section>

      {tax.records.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>How the tax is worked out</h2>
              <p>Losses are set off first (short-term against any gain, long-term only against long-term), then the exemption.</p>
            </div>
            <button className="link-btn" onClick={() => setShowTable((s) => !s)}>
              {showTable ? 'Hide' : 'Show'} detailed calculation
            </button>
          </div>
          <Waterfall tax={tax} />
          <div style={{ marginTop: 14 }}>
            <BroughtForward key={fy} bf={bf} setBf={setBf} tax={tax} />
          </div>
          {showTable && (
            <div style={{ marginTop: 18 }}>
              <TaxTable tax={tax} />
            </div>
          )}
        </section>
      )}

      {(notes.length > 0 || warnings.length > 0) && (
        <section className="notes">
          {notes.map((n) => (
            <div key={n.title} className={`note ${n.tone}`}>
              <span className="note-icon">{NOTE_ICON[n.tone]}</span>
              <div>
                <strong>{n.title}</strong>
                <p>{n.body}</p>
              </div>
              {n.action && (
                <button className="btn btn-ghost btn-sm" onClick={() => goTo(n.action)}>
                  Save tax →
                </button>
              )}
            </div>
          ))}
          {warnings.length > 0 && (
            <details className="note warn">
              <summary>
                <span className="note-icon">⚠️</span> <strong>{warnings.length} data note(s) from your file</strong>
              </summary>
              <ul>
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      {funds.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Gains by fund</h2>
              <p>Click a fund to see each sale and the purchases it used (oldest first, FIFO).</p>
            </div>
            <div className="legend" style={{ margin: 0 }}>
              <span className="legend-item"><i className="swatch" style={{ background: 'var(--series-1)' }} />Short-term</span>
              <span className="legend-item"><i className="swatch" style={{ background: 'var(--series-2)' }} />Long-term</span>
            </div>
          </div>
          <div className="fund-list">
            {funds.map((f) => {
              const bar = (v, cls) => {
                if (Math.abs(v) < 0.5) return null;
                const zero = hasNeg ? 50 : 0;
                const w = (Math.abs(v) / maxAbs) * (hasNeg ? 50 : 100);
                return <div className={`hbar ${cls} ${v >= 0 ? 'right' : 'left'}`} style={{ left: `${v >= 0 ? zero : zero - w}%`, width: `${Math.max(w, 0.8)}%` }} />;
              };
              const isOpen = openFund === f.fund;
              return (
                <div key={f.fund} className={`fund-item ${isOpen ? 'open' : ''}`}>
                  <button className="fund-row" onClick={() => setOpenFund(isOpen ? null : f.fund)} aria-expanded={isOpen}>
                    <span className="fund-row-name">
                      <span className={`caret ${isOpen ? 'open' : ''}`}>▶</span>
                      {shortFund(f.fund)} <span className={`badge ${f.assetClass}`}>{f.assetClass}</span>
                      <span className="muted small"> · {f.sales.length} sale{f.sales.length > 1 ? 's' : ''}</span>
                    </span>
                    <span className="hbar-track">
                      {hasNeg && <span className="hbar-axis" style={{ left: '50%' }} />}
                      {bar(f.st, 's1')}
                      {bar(f.lt, 's2')}
                    </span>
                    <span className={`fund-row-total num ${signClass(f.st + f.lt)}`}>{inr(f.st + f.lt)}</span>
                  </button>
                  {isOpen && <FundSales sales={f.sales} />}
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
