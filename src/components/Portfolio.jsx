import { Fragment, useMemo, useState } from 'react';
import { ASSET_CLASSES, CLASS_INFO } from '../lib/tax';
import { taxDelta } from '../lib/planner';
import { inr, inrCompact, units, signClass, pct, shortFund } from '../lib/format';
import { formatDate } from '../lib/dates';
import { StackBar } from './charts';

const CLASS_COLOR = { Equity: 'var(--series-1)', Debt: 'var(--series-3)', Other: 'var(--series-4)', Unknown: 'var(--series-5)' };
const SOURCE_LABEL = { manual: 'set by you', amfi: 'AMFI category', heuristic: 'from name' };

function TrySell({ model, fund, onAdd, onClose }) {
  const max = fund.sellableUnits;
  const [qty, setQty] = useState(String(Math.floor(max * 1000 + 1e-6) / 1000));
  const [nav, setNav] = useState(fund.nav ? String(fund.nav.nav) : '');
  const q = parseFloat(qty);
  const n = parseFloat(nav);
  const valid = q > 0 && q <= max + 1e-6 && n > 0;
  const result = useMemo(() => (valid ? taxDelta(model, [{ id: 'try', fund: fund.name, units: q, nav: n }]) : null), [valid, model, fund.name, q, n]);
  const st = result ? result.extra.filter((r) => r.term === 'ST').reduce((a, r) => a + r.gain, 0) : 0;
  const lt = result ? result.extra.filter((r) => r.term === 'LT').reduce((a, r) => a + r.gain, 0) : 0;

  return (
    <div className="try-sell">
      <div className="try-inputs">
        <label className="field">
          Units to sell · oldest first (max {units(max)})
          <input className="input" type="number" min="0" step="0.001" value={qty} onChange={(e) => setQty(e.target.value)} />
        </label>
        <label className="field">
          At NAV (₹)
          <input className="input" type="number" min="0" step="0.0001" value={nav} onChange={(e) => setNav(e.target.value)} />
        </label>
      </div>
      {result ? (
        <div className="try-result">
          <div><span>You'd receive</span><strong className="num">{inr(q * n)}</strong></div>
          <div><span>Short-term gain</span><strong className={`num ${signClass(st)}`}>{inr(st)}</strong></div>
          <div><span>Long-term gain</span><strong className={`num ${signClass(lt)}`}>{inr(lt)}</strong></div>
          <div>
            <span>Tax this year changes by</span>
            <strong className={`num ${signClass(-result.delta)}`}>{result.delta > 0.5 ? '+' : ''}{inr(result.delta)}</strong>
          </div>
        </div>
      ) : (
        <p className="muted small">Enter units and a NAV to see the tax effect.</p>
      )}
      <div className="try-actions">
        <button className="btn btn-sm" disabled={!valid} onClick={() => onAdd({ fund: fund.name, units: q, nav: n })}>
          Add as what-if sale
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
        <span className="muted small">What-ifs show up in the Tax report and Save tax until you reset them.</span>
      </div>
    </div>
  );
}

function NavEdit({ fund, onNav }) {
  const [draft, setDraft] = useState(null);
  const value = draft ?? (fund.nav?.nav != null ? String(fund.nav.nav) : '');
  return (
    <input
      className="input input-nav"
      type="number"
      min="0"
      step="0.0001"
      placeholder="Enter NAV"
      value={value}
      aria-label={`NAV for ${fund.name}`}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft != null) onNav(fund.name, parseFloat(draft) || 0);
        setDraft(null);
      }}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
    />
  );
}

function SchemeFix({ name, msg, onSchemeCode }) {
  const [code, setCode] = useState('');
  return (
    <form
      className="scheme-fix"
      onSubmit={(e) => {
        e.preventDefault();
        if (code.trim()) onSchemeCode(name, code.trim());
      }}
    >
      <span className="small">
        <strong>{shortFund(name)}</strong> <span className="muted">({msg})</span>
      </span>
      <input className="input" style={{ width: 130 }} placeholder="AMFI scheme code" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" />
      <button className="btn btn-ghost btn-sm" type="submit">Use code</button>
    </form>
  );
}

export default function Portfolio({ model, navStatus, autoNav, setAutoNav, onFetch, onOverride, onNav, onSchemeCode, onAddSim }) {
  const [open, setOpen] = useState(null);
  const [trying, setTrying] = useState(null);
  const [showSold, setShowSold] = useState(false);
  const held = model.funds.filter((f) => f.units > 1e-6);
  const sold = model.funds.filter((f) => f.units <= 1e-6);
  const list = showSold ? [...held, ...sold] : held;
  const priced = held.filter((f) => f.value != null);
  const worth = priced.reduce((a, f) => a + f.value, 0);
  const pricedCost = priced.reduce((a, f) => a + f.cost, 0);
  const invested = held.reduce((a, f) => a + f.cost, 0);
  const gain = worth - pricedCost;
  const ltValue = model.lots.filter((l) => l.term === 'LT').reduce((a, l) => a + (l.value ?? l.cost), 0);
  const errors = Object.entries(navStatus.errors ?? {});
  const navDate = (() => {
    const counts = {};
    priced.forEach((f) => f.nav.navDate && (counts[f.nav.navDate] = (counts[f.nav.navDate] ?? 0) + 1));
    return Object.entries(counts).sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0]?.[0];
  })();

  const allocation = ASSET_CLASSES.map((c) => ({
    label: c,
    value: held.filter((f) => f.assetClass === c).reduce((a, f) => a + (f.value ?? f.cost), 0),
    color: CLASS_COLOR[c],
  }));

  return (
    <div className="stack">
      <section className="hero-panel">
        <div className="hero-left">
          <div className="hero-figure">
            <span className="hero-kicker">{priced.length ? 'Worth today' : 'Invested'}</span>
            <span className="hero-number num">{inr(priced.length ? worth : invested)}</span>
            <span className="hero-sub">
              {priced.length ? (
                <>
                  <span className={signClass(gain)}>
                    {gain >= 0 ? '▲' : '▼'} {inr(Math.abs(gain))} ({pct(pricedCost ? gain / pricedCost : 0)})
                  </span>{' '}
                  · invested {inr(invested)} · {held.length} funds
                </>
              ) : navStatus.loading ? (
                'Loading live prices…'
              ) : (
                `${held.length} funds · no live prices yet`
              )}
            </span>
          </div>
        </div>
        <div className="hero-right">
          <div className="mini-stat">
            <span>Already long-term</span>
            <strong className="num">{inrCompact(ltValue)}</strong>
          </div>
          <div className="mini-stat price-source">
            <span>
              {navStatus.loading ? (
                <><span className="spinner" /> fetching prices {navStatus.done}/{navStatus.total}</>
              ) : navDate ? (
                <>
                  <span className={`dot ${navStatus.via === 'server' ? 'ready' : ''}`} /> NAVs of {formatDate(navDate)} ·{' '}
                  {navStatus.via === 'server' ? 'GainWise server' : navStatus.via === 'mfapi' ? 'mfapi.in' : 'entered by you'}
                </>
              ) : (
                'No prices loaded'
              )}
            </span>
            <span className="price-actions">
              <button className="link-btn" onClick={() => onFetch()} disabled={navStatus.loading}>
                {priced.length ? 'Refresh' : 'Load prices'}
              </button>
              <label className="small check">
                <input type="checkbox" checked={autoNav} onChange={(e) => setAutoNav(e.target.checked)} /> auto
              </label>
            </span>
          </div>
        </div>
      </section>

      {errors.length > 0 && !navStatus.loading && (
        <div className="note warn">
          <span className="note-icon">🔎</span>
          <div style={{ flex: 1 }}>
            <strong>No price found for {errors.length} fund(s)</strong>
            <p>Enter the AMFI scheme code (find it on mfapi.in or your AMC's site), or type a NAV in the fund's row.</p>
            {errors.map(([name, msg]) => (
              <SchemeFix key={name} name={name} msg={msg} onSchemeCode={onSchemeCode} />
            ))}
          </div>
        </div>
      )}

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Your funds</h2>
            <p>Click a fund for its purchase lots. "Try selling" shows the tax a sale would cost today.</p>
          </div>
          {sold.length > 0 && (
            <button className="link-btn" onClick={() => setShowSold((s) => !s)}>
              {showSold ? 'Hide' : 'Show'} {sold.length} fully sold
            </button>
          )}
        </div>

        <div className="table-wrap">
          <table className="funds-table">
            <thead>
              <tr>
                <th>Fund</th>
                <th>Type</th>
                <th className="r">Value</th>
                <th className="r">Gain</th>
                <th>Long-term</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((f) => {
                const isOpen = open === f.name;
                const isHeld = f.units > 1e-6;
                return (
                  <Fragment key={f.name}>
                    <tr className={isHeld ? 'clickable' : 'muted-row'} onClick={(e) => {
                      if (!isHeld || e.target.closest('select,input,button')) return;
                      setOpen(isOpen ? null : f.name);
                    }}>
                      <td className="fund-name">
                        {isHeld && <span className={`caret ${isOpen ? 'open' : ''}`}>▶</span>}
                        {shortFund(f.name)}
                        <div className="muted small">{isHeld ? `${units(f.units)} units` : 'fully sold'}{f.nav?.nav ? ` · NAV ${inr(f.nav.nav, { paise: true })}` : ''}</div>
                      </td>
                      <td>
                        <select
                          className={`class-select ${f.assetClass}`}
                          value={f.classSource === 'manual' ? f.assetClass : ''}
                          onChange={(e) => onOverride(f.name, e.target.value)}
                          title={CLASS_INFO[f.assetClass]}
                          aria-label={`Tax type for ${f.name}`}
                        >
                          <option value="">{f.classSource === 'manual' ? 'Auto' : `${f.assetClass} (auto)`}</option>
                          {ASSET_CLASSES.filter((c) => c !== 'Unknown').map((c) => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                        <div className="muted small">{SOURCE_LABEL[f.classSource]}</div>
                      </td>
                      <td className="r">
                        {isHeld ? (f.value != null ? inr(f.value) : '—') : '—'}
                        {isHeld && <div className="muted small">cost {inr(f.cost)}</div>}
                      </td>
                      <td className={`r ${signClass(f.gain ?? 0)}`}>
                        {f.gain != null && isHeld ? (
                          <>
                            {inr(f.gain)}
                            <div className="small">{pct(f.cost ? f.gain / f.cost : 0)}</div>
                          </>
                        ) : '—'}
                      </td>
                      <td className="small">
                        {isHeld && (
                          <>
                            <div className="lt-meter" title={`${units(f.ltUnits)} of ${units(f.units)} units long-term`}>
                              <div style={{ width: `${(f.ltUnits / f.units) * 100}%` }} />
                            </div>
                            {f.nextLt ? (
                              <span className="muted">next {formatDate(f.nextLt)}</span>
                            ) : f.ltUnits >= f.units - 1e-6 ? (
                              <span className="muted">all long-term</span>
                            ) : (
                              <span className="muted">{f.ltUnits > 1e-6 ? 'rest always at slab' : 'always at slab rate'}</span>
                            )}
                          </>
                        )}
                      </td>
                      <td className="r">
                        {isHeld && (
                          <button className="btn btn-ghost btn-sm" onClick={() => setTrying(trying === f.name ? null : f.name)} disabled={f.sellableUnits <= 0}>
                            Try selling
                          </button>
                        )}
                      </td>
                    </tr>
                    {trying === f.name && (
                      <tr className="lot">
                        <td colSpan={6}>
                          <TrySell model={model} fund={f} onClose={() => setTrying(null)} onAdd={(s) => { onAddSim(s); setTrying(null); }} />
                        </td>
                      </tr>
                    )}
                    {isOpen && (
                      <>
                        <tr className="lot">
                          <td colSpan={6}>
                            <div className="fund-meta">
                              <span>{f.nav?.schemeName ?? 'Scheme not matched yet'}</span>
                              {f.nav?.category && <span className="muted">{f.nav.category}</span>}
                              <span className="nav-edit">NAV <NavEdit fund={f} onNav={onNav} /></span>
                            </div>
                          </td>
                        </tr>
                        {f.lots.map((l, i) => (
                          <tr className="lot" key={i}>
                            <td style={{ paddingLeft: 30 }}>
                              Bought {formatDate(l.buyDate)} @ {inr(l.buyNav, { paise: true })}
                              <div className="muted small">
                                held {l.ageDays} days{l.deemed ? ' · always slab rate (Sec 50AA)' : ''}
                                {l.fmv2018 ? ` · 2018 NAV ${inr(l.fmv2018, { paise: true })}` : ''}
                              </div>
                            </td>
                            <td>
                              <span className={`badge ${l.term === 'LT' ? 'lt' : 'st'}`}>{l.term === 'LT' ? 'Long-term' : 'Short-term'}</span>
                            </td>
                            <td className="r">{l.value != null ? inr(l.value) : inr(l.cost)}</td>
                            <td className={`r ${signClass(l.gain ?? 0)}`}>{l.gain != null ? inr(l.gain) : '—'}</td>
                            <td className="small">{l.ltFrom ? <>from {formatDate(l.ltFrom)} <span className="days-pill">{l.daysToLt}d</span></> : l.term === 'LT' ? 'yes' : 'never'}</td>
                            <td className="r small muted">{units(l.units)} u</td>
                          </tr>
                        ))}
                      </>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Allocation by tax type</h2>
            <p>{priced.length === held.length ? 'At current value' : 'At current value where a price is known, otherwise at cost'}</p>
          </div>
        </div>
        <StackBar parts={allocation} format={inrCompact} />
      </section>
    </div>
  );
}
