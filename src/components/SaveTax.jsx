import { useMemo, useState } from 'react';
import { inr, units, shortFund, signClass } from '../lib/format';
import { fyLabel, formatDate, daysBetween } from '../lib/dates';
import { buildIcs } from '../lib/calendar';
import { downloadFile } from '../lib/report';
import Withdraw from './Withdraw';

const DATE_ICON = { 'long-term': '⏳', deadline: '🌱', 'advance-tax': '🏦', elss: '🔓' };
const saveIcs = (name, events) => downloadFile(name, buildIcs(events), 'text/calendar;charset=utf-8');

function ActionCard({ action, previewing, onPreview, rank, events }) {
  const [open, setOpen] = useState(false);
  return (
    <article className={`action ${action.kind} ${previewing ? 'previewing' : ''}`}>
      <div className="action-rank">{rank}</div>
      <div className="action-main">
        <h3>
          <span className="action-icon" aria-hidden>{action.icon}</span> {action.title}
        </h3>
        <p>{action.why}</p>
        <div className="action-buttons">
          {action.sales && (
            <button className={`btn btn-sm ${previewing ? 'btn-ghost' : ''}`} onClick={onPreview}>
              {previewing ? 'Undo preview' : 'Preview'}
            </button>
          )}
          {events?.length > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={() => saveIcs('gainwise-reminder.ics', events)}>
              📅 Remind me
            </button>
          )}
          <button className="link-btn small" onClick={() => setOpen((o) => !o)}>
            {open ? 'Hide' : 'Show'} details
          </button>
          {previewing && <span className="badge sim">in preview</span>}
        </div>
        {open && (
          <table className="action-rows">
            <tbody>
              {action.rows.map((r, i) => (
                <tr key={i}>
                  <td>{shortFund(r.fund)}</td>
                  <td className="r num">{units(r.units)} units</td>
                  <td className="r num">{r.value != null ? `≈ ${inr(r.value)}` : ''}</td>
                  <td className="muted small">{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="action-saving">
        <strong className="num">{inr(action.saving)}</strong>
        <span>{action.savingLabel}</span>
      </div>
    </article>
  );
}

export default function SaveTax({ plan, dates, baseModel, model, sims, setSims, navStatus }) {
  const { actions, total, missingNav } = plan;
  const before = useMemo(() => baseModel.taxFor(baseModel.currentFy), [baseModel]);
  const after = useMemo(() => model.taxFor(model.currentFy), [model]);
  const held = baseModel.funds.filter((f) => f.units > 1e-6);
  const unpriced = held.filter((f) => !f.nav);

  const isPreviewing = (a) => sims.some((s) => s.action === a.id);
  const toggle = (a) =>
    setSims((list) =>
      isPreviewing(a)
        ? list.filter((s) => s.action !== a.id)
        : [...list, ...a.sales.map((x, i) => ({ id: `${a.id}#${i}`, action: a.id, date: baseModel.today, ...x }))],
    );

  return (
    <div className="stack">
      <section className="hero-panel">
        <div className="hero-left">
          <div className="hero-figure">
            <span className="hero-kicker">You could save</span>
            <span className="hero-number num pos">{inr(total)}</span>
            <span className="hero-sub">
              {actions.length} idea{actions.length === 1 ? '' : 's'} for {fyLabel(baseModel.currentFy)}, ranked by rupees saved ·
              based on today's NAVs
            </span>
          </div>
        </div>
        <div className="hero-right">
          <div className="mini-stat">
            <span>Tax booked so far this year</span>
            <strong className="num">{inr(before.total)}</strong>
          </div>
          <div className="mini-stat">
            <span>Tax-free gains left</span>
            <strong className="num">{inr(before.exemptionLeft)}</strong>
          </div>
        </div>
      </section>

      {sims.length > 0 && (
        <section className="preview-bar">
          <div>
            <strong>Previewing {sims.length} sale{sims.length > 1 ? 's' : ''}</strong>
            <span>
              Tax this year {inr(before.total)} → <strong className={signClass(before.total - after.total)}>{inr(after.total)}</strong>
              {Math.abs(after.total - before.total) < 0.5 && ' (no extra tax)'}
            </span>
          </div>
          <div className="preview-chips">
            {sims.map((s) => (
              <span key={s.id} className="chip-sim">
                {shortFund(s.fund)} · {units(s.units)} u
                <button aria-label="Remove" onClick={() => setSims((l) => l.filter((x) => x.id !== s.id))}>✕</button>
              </span>
            ))}
            <button className="btn btn-ghost btn-sm" onClick={() => setSims([])}>Reset all</button>
          </div>
        </section>
      )}

      <Withdraw
        model={model}
        previewing={sims.some((s) => s.action === 'withdraw')}
        onUndo={() => setSims((list) => list.filter((s) => s.action !== 'withdraw'))}
        onPreview={(sales, date) =>
          setSims((list) => [
            ...list.filter((s) => s.action !== 'withdraw'),
            ...sales.map((x, i) => ({ id: `withdraw#${i}`, action: 'withdraw', date, fund: x.fund, units: x.units, nav: x.nav })),
          ])
        }
      />

      {unpriced.length > 0 && (
        <div className="note info">
          <span className="note-icon">ℹ️</span>
          <div>
            <strong>{navStatus.loading ? 'Loading live prices…' : `${unpriced.length} fund(s) have no price yet`}</strong>
            <p>Ideas use today's NAVs; funds without a price are left out. You can enter a NAV on the Portfolio screen.</p>
          </div>
        </div>
      )}

      {actions.length > 0 ? (
        <div className="actions">
          {actions.map((a, i) => (
            <ActionCard
              key={a.id}
              rank={i + 1}
              action={a}
              previewing={isPreviewing(a)}
              onPreview={() => toggle(a)}
              events={a.kind === 'wait' ? dates.filter((d) => d.kind === 'long-term' && a.lots.some((l) => l.ltFrom === d.date && d.title.startsWith(shortFund(l.fund)))) : null}
            />
          ))}
        </div>
      ) : (
        <section className="panel empty-state">
          <div className="empty-icon">✅</div>
          <h2>Nothing to optimise right now</h2>
          <p>
            No unused exemption to harvest{missingNav.length ? ' (some equity funds have no price yet)' : ''}, no losses that would
            cut this year's tax, and no profitable lots about to turn long-term. Check back before 31 March.
          </p>
        </section>
      )}

      {dates.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Upcoming tax dates</h2>
              <p>Long-term dates, the 31 March deadline, advance-tax instalments and ELSS unlocks for {fyLabel(baseModel.currentFy)}.</p>
            </div>
            <button className="btn btn-ghost" onClick={() => saveIcs('gainwise-tax-dates.ics', dates)}>
              📅 Add all to calendar
            </button>
          </div>
          <ul className="dates">
            {dates.map((d, i) => (
              <li key={i}>
                <span className="date-pill">
                  <strong>{formatDate(d.date).slice(0, 6)}</strong>
                  <span>{d.date.slice(0, 4)}</span>
                </span>
                <div>
                  <strong>{DATE_ICON[d.kind]} {d.title}</strong>
                  <p>{d.detail}</p>
                </div>
                <span className="muted small nowrap">in {daysBetween(baseModel.today, d.date)} days</span>
              </li>
            ))}
          </ul>
          <p className="muted small" style={{ marginTop: 10 }}>The .ics file opens in Google Calendar, Outlook or Apple Calendar. It's built in your browser; nothing is uploaded.</p>
        </section>
      )}

      <p className="muted small">
        Estimates for planning, not tax advice. Selling and buying back resets the holding period; check exit loads before
        acting. Funds you can't sell yet (e.g. locked ELSS units) are excluded.
      </p>
    </div>
  );
}
