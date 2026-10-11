import { inr, pct } from '../lib/format';
import { headColor } from '../lib/tax';

export default function TaxTable({ tax, showSwatch = true }) {
  const rows = tax.rows.filter((r) => r.gains > 0.5 || r.losses > 0.5);
  if (!rows.length) return <div className="empty">No capital gains or losses in this year.</div>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Tax head</th>
            <th className="r">Gains</th>
            <th className="r">Losses</th>
            <th className="r">Other losses set off</th>
            <th className="r">Exempt</th>
            <th className="r">Taxable</th>
            <th className="r">Rate</th>
            <th className="r">Tax</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {showSwatch && <i className="swatch" style={{ background: headColor(r.key) }} />}
                  <div>
                    <div style={{ fontWeight: 600 }}>{r.label}</div>
                    <div className="muted small">{r.section}</div>
                  </div>
                </div>
              </td>
              <td className="r">{inr(r.gains)}</td>
              <td className="r">{r.losses > 0.5 ? <span className="neg">−{inr(r.losses)}</span> : '—'}</td>
              <td className="r">{r.setOff > 0.5 ? <span className="neg">−{inr(r.setOff)}</span> : '—'}</td>
              <td className="r">{r.exempt > 0.5 ? <span className="pos">−{inr(r.exempt)}</span> : '—'}</td>
              <td className="r">{inr(r.taxable)}</td>
              <td className="r">{pct(r.rate, r.rate * 100 % 1 ? 1 : 0)}</td>
              <td className="r" style={{ fontWeight: 600 }}>{inr(r.tax)}</td>
            </tr>
          ))}
          <tr>
            <td colSpan={7} className="r muted">Health & education cess (4%)</td>
            <td className="r">{inr(tax.cess)}</td>
          </tr>
          <tr className="total">
            <td colSpan={7} className="r">Estimated tax on capital gains</td>
            <td className="r">{inr(tax.total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
