import { useMemo, useState } from 'react';
import { gainHarvestPlan, lossHarvestCandidates, waitAndSave } from '../lib/planner';
import { inr, units, signClass } from '../lib/format';
import { formatDate, fyLabel } from '../lib/dates';

let simSeq = 0;

export default function Planner({ model, sims, setSims, onFetch, navStatus, goTo }) {
  const harvest = useMemo(() => gainHarvestPlan(model), [model]);
  const losses = useMemo(() => lossHarvestCandidates(model), [model]);
  const waits = useMemo(() => waitAndSave(model), [model]);
  const before = useMemo(() => model.taxFor(model.currentFy, { withSims: false }), [model]);
  const after = useMemo(() => model.taxFor(model.currentFy), [model]);
  const held = model.funds.filter((f) => f.units > 1e-6);
  const priced = held.filter((f) => f.nav);

  const addSims = (rows) =>
    setSims((s) => [...s, ...rows.map((r) => ({ id: `sim-${++simSeq}`, date: model.today, fund: r.fund, units: r.units, nav: r.nav }))]);

  return (
    <div className="stack">
      <div className="alert info">
        <span className="alert-icon">🗓️</span>
        <div style={{ flex: 1 }}>
          <strong>Planning for {fyLabel(model.currentFy)} (current year)</strong>
          <p>
            Ideas below assume you sell today at the latest NAV.{' '}
            {priced.length < held.length
              ? `${held.length - priced.length} of your ${held.length} funds have no NAV yet, so they're left out.`
              : 'All your funds are priced.'}
          </p>
        </div>
        {priced.length < held.length && (
          <button className="btn btn-sm" onClick={() => onFetch()} disabled={navStatus.loading}>
            {navStatus.loading ? <><span className="spinner" /> {navStatus.done}/{navStatus.total}</> : 'Fetch live NAVs'}
          </button>
        )}
      </div>

      {/* ---------- Gain harvesting ---------- */}
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>🌱 Tax-gain harvesting</h2>
            <p>
              Book long-term equity gains up to the tax-free limit, then reinvest the same day. You pay no tax now and your cost
              price goes up, so future tax goes down.
            </p>
          </div>
        </div>
        <div className="plan-summary">
          <div>
            <div className="l">Exemption left</div>
            <div className="v">{inr(harvest.room)}</div>
          </div>
          <div>
            <div className="l">Plan books</div>
            <div className="v pos">{inr(harvest.harvested)}</div>
          </div>
          <div>
            <div className="l">Extra tax today</div>
            <div className="v">{inr(harvest.extraTax ?? 0)}</div>
          </div>
          <div>
            <div className="l">Future tax avoided</div>
            <div className="v pos">≈ {inr(harvest.futureSaving ?? 0)}</div>
          </div>
        </div>
        {harvest.room < 1 ? (
          <div className="empty">The {fyLabel(model.currentFy)} exemption is already used up. Nothing more to harvest tax-free.</div>
        ) : harvest.plan.length === 0 ? (
          <div className="empty">
            No priced equity units are long-term and in profit right now.
            {harvest.missingNav.length > 0 && ' Add NAVs for your equity funds to check again.'}
          </div>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Sell</th>
                    <th className="r">Units</th>
                    <th className="r">At NAV</th>
                    <th className="r">Approx. value</th>
                    <th className="r">LTCG booked</th>
                  </tr>
                </thead>
                <tbody>
                  {harvest.plan.map((p) => (
                    <tr key={p.fund}>
                      <td className="fund-name">{p.fund}</td>
                      <td className="r">{units(p.units)}</td>
                      <td className="r">{inr(p.nav, { paise: true })}</td>
                      <td className="r">{inr(p.value)}</td>
                      <td className="r pos">{inr(p.gain)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap', alignItems: 'center' }}>
              <button className="btn" onClick={() => addSims(harvest.plan)}>Simulate this plan</button>
              <span className="muted small">
                Redeem and buy back on the same day. NAVs move, so leave some headroom. Check exit loads first; most equity funds
                charge none after 1 year.
              </span>
            </div>
          </>
        )}
      </section>

      <div className="grid grid-2">
        {/* ---------- Loss harvesting ---------- */}
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>✂️ Tax-loss harvesting</h2>
              <p>Funds in the red whose sale would offset gains you've already booked this year.</p>
            </div>
          </div>
          {losses.length === 0 ? (
            <div className="empty">
              {after.stcg + after.ltcg <= 0 ? 'No taxable gains this year to offset.' : 'No priced fund would lower your tax if sold today.'}
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Fund</th>
                    <th className="r">Loss</th>
                    <th className="r">Tax saved</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {losses.map((c) => (
                    <tr key={c.fund}>
                      <td className="fund-name">
                        {c.fund}
                        <div className="muted small" style={{ fontWeight: 400 }}>sell all {units(c.units)} units ≈ {inr(c.value)}</div>
                      </td>
                      <td className="r neg">{inr(c.st + c.lt)}</td>
                      <td className="r pos">{inr(c.saving)}</td>
                      <td className="r">
                        <button className="btn btn-ghost btn-sm" onClick={() => addSims([{ fund: c.fund, units: c.units, nav: model.funds.find((f) => f.name === c.fund).nav.nav }])}>
                          Simulate
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ---------- Wait and save ---------- */}
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>⏳ Wait and save</h2>
              <p>Lots in profit that become long-term soon. Selling them before that date costs more tax.</p>
            </div>
          </div>
          {waits.length === 0 ? (
            <div className="empty">No profitable short-term lots turning long-term in the next 12 months{priced.length ? '' : ' (add NAVs to check)'}.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Fund</th>
                    <th>Long-term from</th>
                    <th className="r">Gain</th>
                    <th className="r">Save by waiting</th>
                  </tr>
                </thead>
                <tbody>
                  {waits.slice(0, 12).map((w, i) => (
                    <tr key={i}>
                      <td className="fund-name">
                        {w.fund}
                        <div className="muted small" style={{ fontWeight: 400 }}>{units(w.units)} units bought {formatDate(w.buyDate)}</div>
                      </td>
                      <td className="nowrap">
                        {formatDate(w.ltFrom)} <span className="days-pill">{w.daysToLt}d</span>
                      </td>
                      <td className="r pos">{inr(w.gain)}</td>
                      <td className="r pos">{inr(w.saving)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {waits.length > 12 && <p className="muted small" style={{ marginTop: 8 }}>+{waits.length - 12} more lots</p>}
            </div>
          )}
        </section>
      </div>

      {/* ---------- Sandbox ---------- */}
      <Sandbox model={model} held={held} sims={sims} setSims={setSims} addSims={addSims} before={before} after={after} goTo={goTo} />
    </div>
  );
}

function Sandbox({ model, held, sims, setSims, addSims, before, after, goTo }) {
  const [fund, setFund] = useState('');
  const [qty, setQty] = useState('');
  const [nav, setNav] = useState('');
  const selected = held.find((f) => f.name === fund);
  const navValue = nav !== '' ? parseFloat(nav) : selected?.nav?.nav;
  const qtyValue = qty !== '' ? parseFloat(qty) : selected?.units;
  const valid = selected && navValue > 0 && qtyValue > 0 && qtyValue <= selected.units + 1e-6;
  const delta = after.total - before.total;

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>🧪 What-if sandbox</h2>
          <p>Try a sale and see its tax effect. Units are taken FIFO, oldest first, exactly as the tax rules require.</p>
        </div>
      </div>
      <form
        className="sandbox-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          addSims([{ fund, units: qtyValue, nav: navValue }]);
          setQty('');
          setNav('');
        }}
      >
        <label className="field">
          Fund
          <select className="select" value={fund} onChange={(e) => { setFund(e.target.value); setQty(''); setNav(''); }}>
            <option value="">Choose a fund you hold…</option>
            {held.map((f) => (
              <option key={f.name} value={f.name}>{f.name}</option>
            ))}
          </select>
        </label>
        <label className="field">
          Units {selected && <span>(max {units(selected.units)})</span>}
          <input className="input" type="number" min="0" step="0.001" placeholder={selected ? units(selected.units) : '0'} value={qty} onChange={(e) => setQty(e.target.value)} />
        </label>
        <label className="field">
          Sell NAV (₹)
          <input className="input" type="number" min="0" step="0.0001" placeholder={selected?.nav ? String(selected.nav.nav) : 'NAV'} value={nav} onChange={(e) => setNav(e.target.value)} />
        </label>
        <button className="btn" type="submit" disabled={!valid}>Add sale</button>
      </form>

      {sims.length > 0 && (
        <>
          <div className="plan-summary" style={{ marginTop: 20 }}>
            <div>
              <div className="l">Tax without what-ifs</div>
              <div className="v">{inr(before.total)}</div>
            </div>
            <div>
              <div className="l">Tax with what-ifs</div>
              <div className="v">{inr(after.total)}</div>
            </div>
            <div>
              <div className="l">Difference</div>
              <div className={`v ${signClass(-delta)}`}>{delta > 0 ? '+' : ''}{inr(delta)}</div>
            </div>
            <div>
              <div className="l">Exemption left</div>
              <div className="v">{inr(after.exemptionLeft)}</div>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Simulated sale</th>
                  <th className="r">Units</th>
                  <th className="r">NAV</th>
                  <th className="r">Short-term</th>
                  <th className="r">Long-term</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sims.map((s) => {
                  const recs = model.simulated.filter((r) => r.sellId === s.id);
                  const st = recs.filter((r) => r.term === 'ST').reduce((a, r) => a + r.gain, 0);
                  const lt = recs.filter((r) => r.term === 'LT').reduce((a, r) => a + r.gain, 0);
                  return (
                    <tr key={s.id} className="sim">
                      <td className="fund-name">{s.fund}</td>
                      <td className="r">{units(s.units)}</td>
                      <td className="r">{inr(s.nav, { paise: true })}</td>
                      <td className={`r ${signClass(st)}`}>{inr(st)}</td>
                      <td className={`r ${signClass(lt)}`}>{inr(lt)}</td>
                      <td className="r">
                        <button className="btn btn-danger btn-sm" onClick={() => setSims((x) => x.filter((y) => y.id !== s.id))}>Remove</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
            <button className="btn btn-ghost" onClick={() => goTo('overview')}>See full {fyLabel(model.currentFy)} breakdown</button>
            <button className="btn btn-danger" onClick={() => setSims([])}>Clear all what-ifs</button>
          </div>
        </>
      )}
    </section>
  );
}
