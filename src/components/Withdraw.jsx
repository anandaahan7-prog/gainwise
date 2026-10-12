import { useState } from 'react';
import { planWithdrawal } from '../lib/withdraw';
import { inr, units, shortFund } from '../lib/format';
import { addDays, fyLabel, formatDate } from '../lib/dates';

// "I need ₹X by a date": the lowest-tax way to raise cash from the portfolio.
export default function Withdraw({ model, onPreview, previewing, onUndo }) {
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(model.today);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const amt = parseFloat(amount);
  const priced = model.funds.filter((f) => f.nav && f.units > 1e-6).length;

  const run = (e) => {
    e.preventDefault();
    if (!(amt > 0)) return;
    setBusy(true);
    // Let the button paint "Working…" before the (synchronous) search runs
    setTimeout(() => {
      setResult(planWithdrawal(model, amt, { date }));
      setBusy(false);
    }, 20);
  };

  const saved = result ? result.baselineExtraTax - result.extraTax : 0;

  return (
    <section className="panel withdraw">
      <div className="panel-head">
        <div>
          <h2>💸 Need cash? Raise it with the least tax</h2>
          <p>Tell us how much and when. We pick which units to redeem, oldest first in each fund, so the extra tax is as low as possible.</p>
        </div>
      </div>
      <form className="withdraw-form" onSubmit={run}>
        <label className="field">
          Amount needed (₹)
          <input className="input" type="number" min="1" step="any" placeholder="e.g. 200000" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label className="field">
          Sell on
          <input className="input" type="date" min={model.today} max={addDays(model.today, 365)} value={date} onChange={(e) => setDate(e.target.value || model.today)} />
        </label>
        <button className="btn" type="submit" disabled={!(amt > 0) || busy || !priced}>
          {busy ? 'Working…' : 'Find the cheapest way'}
        </button>
      </form>
      {!priced && <p className="muted small">Needs live prices; load them on the Portfolio screen.</p>}

      {result && (
        <div className="withdraw-result">
          <div className="plan-stats">
            <div>
              <span>Raises</span>
              <strong className="num">{inr(result.raised)}</strong>
            </div>
            <div>
              <span>Extra tax ({fyLabel(result.fy)})</span>
              <strong className="num">{inr(result.extraTax)}</strong>
            </div>
            <div>
              <span>Effective rate</span>
              <strong className="num">{result.raised ? ((result.extraTax / result.raised) * 100).toFixed(2) : '0.00'}%</strong>
            </div>
            <div>
              <span>vs selling every fund equally</span>
              <strong className={`num ${saved > 0.5 ? 'pos' : ''}`}>{saved > 0.5 ? `${inr(saved)} less tax` : 'same tax'}</strong>
            </div>
          </div>
          {result.shortfall > 0.5 && (
            <p className="note warn small">
              Only {inr(result.raised)} can be raised from priced, unlocked units. {inr(result.shortfall)} short.
            </p>
          )}
          <table className="action-rows">
            <tbody>
              {result.sales.map((s) => (
                <tr key={s.fund}>
                  <td>Redeem from {shortFund(s.fund)}</td>
                  <td className="r num">{units(s.units)} units</td>
                  <td className="r num">≈ {inr(s.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="action-buttons">
            {previewing ? (
              <button className="btn btn-ghost btn-sm" onClick={onUndo}>Undo preview</button>
            ) : (
              <button className="btn btn-sm" onClick={() => onPreview(result.sales, result.date)} disabled={!result.sales.length}>
                Preview these sales
              </button>
            )}
            <span className="muted small">
              Sale date {formatDate(result.date)} at today's NAVs. Exit loads aren't included.
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
