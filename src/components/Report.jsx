import { useMemo } from 'react';
import { capitalGainsCsv, schedule112ACsv, downloadFile } from '../lib/report';
import { groupSales } from '../lib/portfolio';
import { inr, units } from '../lib/format';
import { formatDate, fyLabel } from '../lib/dates';
import TaxTable from './TaxTable';

export default function Report({ model, tax, navs }) {
  const sales = useMemo(() => groupSales(tax.records), [tax]);
  const slug = fyLabel(tax.fy).replace(/\s+/g, '-');
  const hasSims = tax.records.some((r) => r.simulated);
  const has112A = tax.records.some((r) => r.head === 'EQ_LT_POST' || r.head === 'EQ_LT_PRE');
  const missingIsin = tax.records.some((r) => !navs[r.fund]?.isin);

  return (
    <div className="stack">
      <section className="panel no-print">
        <div className="panel-head">
          <div>
            <h2>Export {fyLabel(tax.fy)}</h2>
            <p>Files are generated in your browser. Use them to fill Schedule CG / 112A in your ITR, or send them to your CA.</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => window.print()} disabled={!tax.records.length}>
            🖨️ Print / save as PDF
          </button>
          <button className="btn btn-ghost" onClick={() => downloadFile(`capital-gains-${slug}.csv`, capitalGainsCsv(tax, navs))} disabled={!tax.records.length}>
            ⬇ Lot-wise statement (CSV)
          </button>
          <button className="btn btn-ghost" onClick={() => downloadFile(`schedule-112A-${slug}.csv`, schedule112ACsv(tax, navs))} disabled={!has112A}>
            ⬇ Schedule 112A draft (CSV)
          </button>
        </div>
        {hasSims && (
          <div className="alert warn" style={{ marginTop: 14 }}>
            <span className="alert-icon">🧪</span>
            <div><strong>Includes what-if sales</strong><p>Remove them in the tax planner before exporting for filing.</p></div>
          </div>
        )}
        {missingIsin && (
          <p className="muted small" style={{ marginTop: 12 }}>
            Tip: fetch live NAVs on the Funds tab first. That also fills in each scheme's ISIN, which Schedule 112A asks for.
          </p>
        )}
      </section>

      <section className="panel print-report">
        <h1>Capital gains report · {fyLabel(tax.fy)}</h1>
        <p className="muted small">
          Generated {formatDate(model.today)} by GainWise · income slab {Math.round(model.slab * 100)}% · estimates only, not tax advice
        </p>

        <div className="grid grid-4" style={{ margin: '18px 0' }}>
          <div className="tile"><div className="tile-label">Short-term gains</div><div className="tile-value">{inr(tax.stcg)}</div></div>
          <div className="tile"><div className="tile-label">Long-term gains</div><div className="tile-value">{inr(tax.ltcg)}</div></div>
          <div className="tile"><div className="tile-label">Exemption used</div><div className="tile-value">{inr(tax.exemptionUsed)}</div></div>
          <div className="tile"><div className="tile-label">Estimated tax</div><div className="tile-value">{inr(tax.total)}</div></div>
        </div>

        <h2 style={{ fontSize: '1rem', margin: '8px 0 10px' }}>Tax computation</h2>
        <TaxTable tax={tax} showSwatch={false} />

        <h2 style={{ fontSize: '1rem', margin: '24px 0 10px' }}>Redemptions</h2>
        {sales.length === 0 ? (
          <div className="empty">No redemptions.</div>
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
                  <th className="r">STCG</th>
                  <th className="r">LTCG</th>
                </tr>
              </thead>
              <tbody>
                {sales.map((s) => (
                  <tr key={s.id}>
                    <td>{s.fund}{s.simulated ? ' (what-if)' : ''}</td>
                    <td className="nowrap">{formatDate(s.sellDate)}</td>
                    <td className="r">{units(s.units)}</td>
                    <td className="r">{inr(s.cost)}</td>
                    <td className="r">{inr(s.proceeds)}</td>
                    <td className="r">{inr(s.st)}</td>
                    <td className="r">{inr(s.lt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {(tax.carryForward.st > 1 || tax.carryForward.lt > 1) && (
          <p style={{ marginTop: 14 }}>
            Losses to carry forward: short-term {inr(tax.carryForward.st)}, long-term {inr(tax.carryForward.lt)}.
          </p>
        )}
        <p className="muted small" style={{ marginTop: 18 }}>
          Assumptions: FIFO matching per scheme; resident individual; surcharge not applied; equity units bought before 1 Feb 2018
          use the 31 Jan 2018 NAV for grandfathering where it was fetched{tax.records.some((r) => r.needsFmv) ? ' (missing for some lots in this report)' : ''};
          Section 50AA treatment for debt units bought on or after 1 Apr 2023; rates for transfers on or after 23 Jul 2024 per
          Finance (No. 2) Act 2024. Check the figures with your capital-gains statement from CAMS or KFintech before filing.
        </p>
      </section>
    </div>
  );
}
