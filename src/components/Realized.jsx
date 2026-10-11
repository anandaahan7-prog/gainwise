import { Fragment, useMemo, useState } from 'react';
import { groupSales } from '../lib/portfolio';
import { inr, units, signClass } from '../lib/format';
import { formatDate, fyLabel } from '../lib/dates';
import { HEADS } from '../lib/tax';

const Money = ({ v }) => (Math.abs(v) < 0.5 ? <span className="muted">—</span> : <span className={signClass(v)}>{inr(v)}</span>);

export default function Realized({ tax }) {
  const [fund, setFund] = useState('');
  const [open, setOpen] = useState({});
  const sales = useMemo(() => groupSales(tax.records), [tax]);
  const funds = [...new Set(sales.map((s) => s.fund))].sort();
  const shown = fund ? sales.filter((s) => s.fund === fund) : sales;
  const totals = shown.reduce((a, s) => ({ cost: a.cost + s.cost, proceeds: a.proceeds + s.proceeds, st: a.st + s.st, lt: a.lt + s.lt }), { cost: 0, proceeds: 0, st: 0, lt: 0 });

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Redemptions in {fyLabel(tax.fy)}</h2>
            <p>Each sale is matched against your oldest units first (FIFO). Click a row to see the purchase lots it used.</p>
          </div>
          <select className="select" value={fund} onChange={(e) => setFund(e.target.value)} aria-label="Filter by fund">
            <option value="">All funds ({sales.length} sales)</option>
            {funds.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </div>
        {!shown.length ? (
          <div className="empty">No redemptions in this financial year.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Fund</th>
                  <th>Sold on</th>
                  <th className="r">Units</th>
                  <th className="r">Cost</th>
                  <th className="r">Sale value</th>
                  <th className="r">Short-term</th>
                  <th className="r">Long-term</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((s) => (
                  <Fragment key={s.id}>
                    <tr className={`clickable ${s.simulated ? 'sim' : ''}`} onClick={() => setOpen((o) => ({ ...o, [s.id]: !o[s.id] }))}>
                      <td className="fund-name">
                        <span className={`caret ${open[s.id] ? 'open' : ''}`}>▶</span>
                        {s.fund} <span className={`badge ${s.assetClass}`}>{s.assetClass}</span>
                        {s.simulated && <span className="badge sim" style={{ marginLeft: 4 }}>What-if</span>}
                      </td>
                      <td className="nowrap">{formatDate(s.sellDate)}</td>
                      <td className="r">{units(s.units)}</td>
                      <td className="r">{inr(s.cost)}</td>
                      <td className="r">{inr(s.proceeds)}</td>
                      <td className="r"><Money v={s.st} /></td>
                      <td className="r"><Money v={s.lt} /></td>
                    </tr>
                    {open[s.id] &&
                      s.lots.map((l, i) => (
                        <tr className="sub" key={i}>
                          <td style={{ paddingLeft: 32 }}>
                            Bought {formatDate(l.buyDate)} @ {inr(l.buyNav, { paise: true })} → sold @ {inr(l.sellNav, { paise: true })}
                            <div className="muted small">
                              {HEADS[l.head].label} · {HEADS[l.head].section}
                              {l.deemed && ' · deemed short-term (bought after 1 Apr 2023)'}
                              {l.indexedCost != null && ` · indexed cost ${inr(l.indexedCost)}`}
                              {l.grandfatheredCost != null && ` · grandfathered cost ${inr(l.grandfatheredCost)} (31 Jan 2018 FMV)`}
                              {l.needsFmv && ' · bought before Feb 2018: fetch live NAVs to apply grandfathering'}
                            </div>
                          </td>
                          <td><span className={`badge ${l.term === 'LT' ? 'lt' : 'st'}`}>{l.term === 'LT' ? 'Long-term' : 'Short-term'}</span></td>
                          <td className="r">{units(l.units)}</td>
                          <td className="r">{inr(l.cost)}</td>
                          <td className="r">{inr(l.proceeds)}</td>
                          <td className="r">{l.term === 'ST' ? <Money v={l.gain} /> : ''}</td>
                          <td className="r">{l.term === 'LT' ? <Money v={l.gain} /> : ''}</td>
                        </tr>
                      ))}
                  </Fragment>
                ))}
                <tr className="total">
                  <td colSpan={3}>Total</td>
                  <td className="r">{inr(totals.cost)}</td>
                  <td className="r">{inr(totals.proceeds)}</td>
                  <td className="r"><Money v={totals.st} /></td>
                  <td className="r"><Money v={totals.lt} /></td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
