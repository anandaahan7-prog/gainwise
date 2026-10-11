import { useMemo } from 'react';
import { inr, signClass } from '../lib/format';
import { fyLabel, fyRange, monthKey, formatDate } from '../lib/dates';
import { buildInsights } from '../lib/insights';
import TaxTable from './TaxTable';
import { headColor } from '../lib/tax';
import { GainsByFund, StackBar, MonthlyFlow } from './charts';

const ICON = { warn: '⚠️', bad: '🔺', good: '💡', info: 'ℹ️' };

export function Insight({ item, goTo }) {
  return (
    <div className={`alert ${item.tone}`}>
      <span className="alert-icon">{ICON[item.tone]}</span>
      <div style={{ flex: 1 }}>
        <strong>{item.title}</strong>
        <p>{item.body}</p>
      </div>
      {item.action && goTo && (
        <button className="btn btn-ghost btn-sm" onClick={() => goTo(item.action)}>
          Open
        </button>
      )}
    </div>
  );
}

export default function Overview({ model, tax, warnings, goTo }) {
  const insights = useMemo(() => buildInsights(model, tax), [model, tax]);

  const byFund = useMemo(() => {
    const m = new Map();
    for (const r of tax.records) {
      const row = m.get(r.fund) ?? { fund: r.fund, st: 0, lt: 0 };
      if (r.term === 'ST') row.st += r.gain;
      else row.lt += r.gain;
      m.set(r.fund, row);
    }
    return [...m.values()].sort((a, b) => Math.abs(b.st + b.lt) - Math.abs(a.st + a.lt));
  }, [tax]);

  const months = useMemo(() => {
    const [, end] = fyRange(tax.fy);
    const keys = [];
    const [ey, em] = end.split('-').map(Number);
    for (let i = 23; i >= 0; i--) {
      const d = new Date(ey, em - 1 - i, 1);
      keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    const map = Object.fromEntries(keys.map((k) => [k, { key: k, in: 0, out: 0 }]));
    for (const t of model.transactions) {
      const k = monthKey(t.date);
      if (map[k]) map[k][t.side === 'BUY' ? 'in' : 'out'] += t.amount;
    }
    return keys.map((k) => map[k]);
  }, [model, tax.fy]);

  const used = Math.max(tax.equityLT, 0);
  const meterPct = Math.min((used / tax.limit) * 100, 100);
  const over = used > tax.limit;
  const effective = tax.stcg + tax.ltcg > 0 ? tax.total / (tax.stcg + tax.ltcg) : 0;
  const isCurrent = tax.fy === model.currentFy;

  return (
    <div className="stack">
      {model.simulated.length > 0 && isCurrent && (
        <div className="alert warn">
          <span className="alert-icon">🧪</span>
          <div style={{ flex: 1 }}>
            <strong>Includes {new Set(model.simulated.map((s) => s.sellId)).size} simulated sale(s)</strong>
            <p>Numbers for {fyLabel(tax.fy)} include what-if trades from the tax planner.</p>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => goTo('planner')}>Review</button>
        </div>
      )}

      <div className="grid grid-4">
        <div className="tile">
          <div className="tile-label">Short-term gains</div>
          <div className={`tile-value ${signClass(tax.stcg)}`}>{inr(tax.stcg)}</div>
          <div className="tile-sub">{tax.records.filter((r) => r.term === 'ST').length} lots</div>
        </div>
        <div className="tile">
          <div className="tile-label">Long-term gains</div>
          <div className={`tile-value ${signClass(tax.ltcg)}`}>{inr(tax.ltcg)}</div>
          <div className="tile-sub">{tax.records.filter((r) => r.term === 'LT').length} lots</div>
        </div>
        <div className="tile">
          <div className="tile-label">Exemption left</div>
          <div className="tile-value">{inr(tax.exemptionLeft)}</div>
          <div className="tile-sub">of {inr(tax.limit)} equity LTCG limit</div>
        </div>
        <div className="tile hero-tile">
          <div className="tile-label">Estimated tax</div>
          <div className="tile-value">{inr(tax.total)}</div>
          <div className="tile-sub">{effective > 0 ? `${(effective * 100).toFixed(1)}% of net gains · incl. cess` : 'incl. 4% cess'}</div>
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="alert warn">
          <span className="alert-icon">⚠️</span>
          <div>
            <strong>Data notes from the engine</strong>
            <ul>
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="grid grid-2">
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Equity LTCG exemption</h2>
              <p>Section 112A · first {inr(tax.limit)} per year is tax-free</p>
            </div>
          </div>
          <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={tax.limit} aria-valuenow={used}>
            <div className={`meter-fill ${over ? 'over' : ''}`} style={{ width: `${meterPct}%` }} />
          </div>
          <div className="meter-legend">
            <span>
              Used <strong className="num">{inr(Math.min(used, tax.limit))}</strong>
            </span>
            <span>
              {over ? (
                <span className="neg">
                  Over by <strong className="num">{inr(used - tax.limit)}</strong>
                </span>
              ) : (
                <>
                  Left <strong className="num">{inr(tax.exemptionLeft)}</strong>
                </>
              )}
            </span>
          </div>
          <h3 style={{ fontSize: '0.92rem', margin: '22px 0 10px' }}>Where the tax comes from</h3>
          <StackBar parts={tax.rows.filter((r) => r.tax > 0.5).map((r) => ({ label: r.label, value: r.tax, color: headColor(r.key) }))} />
        </section>

        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Insights</h2>
              <p>Generated from your numbers for {fyLabel(tax.fy)}</p>
            </div>
          </div>
          <div className="insights">
            {insights.map((i) => (
              <Insight key={i.title} item={i} goTo={goTo} />
            ))}
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Tax computation</h2>
            <p>
              Losses are set off within the year (short-term losses against any gains, long-term only against long-term) before
              the exemption is applied.
            </p>
          </div>
        </div>
        <TaxTable tax={tax} />
      </section>

      <div className="grid grid-2">
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Realized gains by fund</h2>
              <p>{fyLabel(tax.fy)}</p>
            </div>
          </div>
          <GainsByFund rows={byFund} />
        </section>
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Money in and out</h2>
              <p>
                24 months to {formatDate(fyRange(tax.fy)[1])}
              </p>
            </div>
          </div>
          <MonthlyFlow months={months} />
        </section>
      </div>
    </div>
  );
}
