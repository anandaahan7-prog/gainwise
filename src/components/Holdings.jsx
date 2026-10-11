import { Fragment, useState } from 'react';
import { ASSET_CLASSES, CLASS_INFO } from '../lib/tax';
import { inr, units, signClass, pct } from '../lib/format';
import { formatDate } from '../lib/dates';
import { StackBar } from './charts';

const CLASS_COLOR = { Equity: 'var(--series-1)', Debt: 'var(--series-3)', Other: 'var(--series-4)', Unknown: 'var(--series-5)' };
const SOURCE_LABEL = { manual: 'set by you', amfi: 'AMFI category', heuristic: 'name match' };

function NavCell({ fund, onNav }) {
  const [draft, setDraft] = useState(null);
  const value = draft ?? (fund.nav?.nav != null ? String(fund.nav.nav) : '');
  return (
    <div>
      <input
        className="input input-nav"
        type="number"
        min="0"
        step="0.0001"
        inputMode="decimal"
        placeholder="Enter NAV"
        value={value}
        aria-label={`Current NAV for ${fund.name}`}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft != null) onNav(fund.name, parseFloat(draft) || 0);
          setDraft(null);
        }}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
      {fund.nav?.navDate && (
        <div className="muted small" style={{ textAlign: 'right' }}>
          {fund.nav.source === 'live' ? `live · ${formatDate(fund.nav.navDate)}` : 'manual'}
        </div>
      )}
    </div>
  );
}

export default function Holdings({ model, navStatus, onFetch, onOverride, onNav, onSchemeCode }) {
  const [open, setOpen] = useState({});
  const [showClosed, setShowClosed] = useState(false);
  const held = model.funds.filter((f) => f.units > 1e-6);
  const closed = model.funds.filter((f) => f.units <= 1e-6);
  const list = showClosed ? [...held, ...closed] : held;
  const withNav = held.filter((f) => f.value != null);
  const totalCost = held.reduce((a, f) => a + f.cost, 0);
  const totalValue = withNav.reduce((a, f) => a + f.value, 0);
  const costWithNav = withNav.reduce((a, f) => a + f.cost, 0);
  const unrealized = totalValue - costWithNav;
  const unknown = model.funds.filter((f) => f.assetClass === 'Unknown');
  const errors = Object.entries(navStatus.errors ?? {});

  const byClass = ASSET_CLASSES.map((c) => ({
    label: c,
    value: held.filter((f) => f.assetClass === c).reduce((a, f) => a + (f.value ?? f.cost), 0),
    color: CLASS_COLOR[c],
  }));

  return (
    <div className="stack">
      {unknown.length > 0 && (
        <div className="alert warn">
          <span className="alert-icon">⚠️</span>
          <div>
            <strong>Pick a tax class for {unknown.length} fund{unknown.length > 1 ? 's' : ''}</strong>
            <p>
              We couldn't tell from the name. Use the class dropdown below, or fetch live NAVs: the official AMFI category is used
              automatically.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-4">
        <div className="tile">
          <div className="tile-label">Invested (open lots)</div>
          <div className="tile-value">{inr(totalCost)}</div>
          <div className="tile-sub">{held.length} funds · {model.lots.length} lots</div>
        </div>
        <div className="tile">
          <div className="tile-label">Current value</div>
          <div className="tile-value">{withNav.length ? inr(totalValue) : '—'}</div>
          <div className="tile-sub">{withNav.length < held.length ? `${withNav.length}/${held.length} funds have a NAV` : 'all funds priced'}</div>
        </div>
        <div className="tile">
          <div className="tile-label">Unrealized gain</div>
          <div className={`tile-value ${signClass(unrealized)}`}>{withNav.length ? inr(unrealized) : '—'}</div>
          <div className="tile-sub">{withNav.length && costWithNav ? pct(unrealized / costWithNav) : 'needs NAVs'}</div>
        </div>
        <div className="tile">
          <div className="tile-label">Long-term value today</div>
          <div className="tile-value">{inr(model.lots.filter((l) => l.term === 'LT').reduce((a, l) => a + (l.value ?? l.cost), 0))}</div>
          <div className="tile-sub">units already eligible for LTCG rates</div>
        </div>
      </div>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Your funds</h2>
            <p>
              Live NAVs come from AMFI, through the GainWise NAV server when it's running or mfapi.in otherwise. Only fund names
              are sent, never your units or amounts. You can also type a NAV yourself.
            </p>
            {navStatus.via && !navStatus.loading && (
              <p className="small" style={{ marginTop: 4 }}>
                <span className={`dot ${navStatus.via === 'server' ? 'ready' : ''}`} style={{ display: 'inline-block', marginRight: 6 }} />
                {navStatus.via === 'server' ? 'Served by the GainWise NAV server (AMFI mirror)' : 'GainWise server offline: fetched from mfapi.in'}
              </p>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn" onClick={() => onFetch()} disabled={navStatus.loading || !held.length}>
              {navStatus.loading ? (
                <>
                  <span className="spinner" /> {navStatus.done}/{navStatus.total}
                </>
              ) : withNav.length ? 'Refresh live NAVs' : 'Fetch live NAVs'}
            </button>
            {closed.length > 0 && (
              <button className="btn btn-ghost" onClick={() => setShowClosed((s) => !s)}>
                {showClosed ? 'Hide' : 'Show'} {closed.length} fully sold
              </button>
            )}
          </div>
        </div>

        {errors.length > 0 && (
          <div className="alert warn" style={{ marginBottom: 16 }}>
            <span className="alert-icon">🔎</span>
            <div style={{ flex: 1 }}>
              <strong>Couldn't match {errors.length} fund(s) automatically</strong>
              <p>Enter the AMFI scheme code (search it on mfapi.in or your AMC site) or type the NAV in the table.</p>
              {errors.map(([name, msg]) => (
                <SchemeFix key={name} name={name} msg={msg} onSchemeCode={onSchemeCode} />
              ))}
            </div>
          </div>
        )}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fund</th>
                <th>Tax class</th>
                <th className="r">Units</th>
                <th className="r">Invested</th>
                <th className="r">NAV</th>
                <th className="r">Value</th>
                <th className="r">Gain</th>
                <th>Long-term</th>
              </tr>
            </thead>
            <tbody>
              {list.map((f) => (
                <Fragment key={f.name}>
                  <tr className={f.lots.length ? 'clickable' : ''} onClick={(e) => {
                    if (e.target.closest('select,input,button')) return;
                    setOpen((o) => ({ ...o, [f.name]: !o[f.name] }));
                  }}>
                    <td className="fund-name">
                      {f.lots.length > 0 && <span className={`caret ${open[f.name] ? 'open' : ''}`}>▶</span>}
                      {f.name}
                      {f.nav?.schemeName && <div className="muted small" style={{ fontWeight: 400 }}>{f.nav.schemeName}</div>}
                    </td>
                    <td>
                      <select
                        className={`select class-select badge ${f.assetClass}`}
                        value={f.classSource === 'manual' ? f.assetClass : ''}
                        onChange={(e) => onOverride(f.name, e.target.value)}
                        title={CLASS_INFO[f.assetClass]}
                        aria-label={`Tax class for ${f.name}`}
                      >
                        <option value="">{f.classSource === 'manual' ? 'Auto' : `${f.assetClass} (auto)`}</option>
                        {ASSET_CLASSES.filter((c) => c !== 'Unknown').map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                      <div className="muted small" title={f.classDetail ?? ''}>
                        {SOURCE_LABEL[f.classSource]}
                        {f.classSource === 'heuristic' && f.classDetail ? ` "${f.classDetail}"` : ''}
                      </div>
                    </td>
                    <td className="r">{f.units > 1e-6 ? units(f.units) : <span className="muted">sold</span>}</td>
                    <td className="r">{f.units > 1e-6 ? inr(f.cost) : '—'}</td>
                    <td className="r">{f.units > 1e-6 ? <NavCell fund={f} onNav={onNav} /> : '—'}</td>
                    <td className="r">{f.value != null ? inr(f.value) : '—'}</td>
                    <td className="r">
                      {f.gain != null ? (
                        <>
                          <span className={signClass(f.gain)}>{inr(f.gain)}</span>
                          <div className="muted small">{pct(f.gain / f.cost)}</div>
                        </>
                      ) : '—'}
                    </td>
                    <td className="small">
                      {f.units > 1e-6 && (
                        <>
                          {units(f.ltUnits)} / {units(f.units)}
                          {f.nextLt && <div className="muted">next on {formatDate(f.nextLt)}</div>}
                        </>
                      )}
                    </td>
                  </tr>
                  {open[f.name] &&
                    f.lots.map((l, i) => (
                      <tr className="sub" key={i}>
                        <td style={{ paddingLeft: 32 }}>
                          Bought {formatDate(l.buyDate)} @ {inr(l.buyNav, { paise: true })}
                          <div className="muted small">
                            held {l.ageDays} days{l.deemed ? ' · always taxed at slab (Sec 50AA)' : ''}
                            {l.fmv2018 && ` · 31 Jan 2018 NAV ${inr(l.fmv2018, { paise: true })} (grandfathered)`}
                          </div>
                        </td>
                        <td>
                          <span className={`badge ${l.term === 'LT' ? 'lt' : 'st'}`}>{l.term === 'LT' ? 'Long-term' : 'Short-term'}</span>
                        </td>
                        <td className="r">{units(l.units)}</td>
                        <td className="r">{inr(l.cost)}</td>
                        <td />
                        <td className="r">{l.value != null ? inr(l.value) : '—'}</td>
                        <td className="r">{l.gain != null ? <span className={signClass(l.gain)}>{inr(l.gain)}</span> : '—'}</td>
                        <td className="small">{l.ltFrom ? <>from {formatDate(l.ltFrom)} <span className="days-pill">{l.daysToLt}d</span></> : l.term === 'LT' ? 'yes' : 'never'}</td>
                      </tr>
                    ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Allocation by tax class</h2>
            <p>{withNav.length === held.length ? 'At current value' : 'At current value where a NAV is known, otherwise at cost'}</p>
          </div>
        </div>
        <StackBar parts={byClass} />
      </section>
    </div>
  );
}

function SchemeFix({ name, msg, onSchemeCode }) {
  const [code, setCode] = useState('');
  return (
    <form
      style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}
      onSubmit={(e) => {
        e.preventDefault();
        if (code.trim()) onSchemeCode(name, code.trim());
      }}
    >
      <span className="small" style={{ flex: '1 1 220px' }}>
        <strong style={{ display: 'inline' }}>{name}</strong> <span className="muted">({msg})</span>
      </span>
      <input className="input" style={{ width: 130 }} placeholder="Scheme code" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" />
      <button className="btn btn-ghost btn-sm" type="submit">Use code</button>
    </form>
  );
}
