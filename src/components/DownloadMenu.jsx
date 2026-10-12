import { useEffect, useRef, useState } from 'react';
import { capitalGainsCsv, schedule112ACsv, downloadFile } from '../lib/report';
import { fyLabel } from '../lib/dates';

export default function DownloadMenu({ tax, navs, extraItems = [] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const fy = fyLabel(tax.fy);
  const slug = fy.replace(/\s+/g, '-');
  const has112A = tax.records.some((r) => r.head === 'EQ_LT_POST' || r.head === 'EQ_LT_PRE');
  const hasSims = tax.records.some((r) => r.simulated);
  const run = (fn) => () => {
    setOpen(false);
    fn();
  };

  const items = [
    { label: 'Tax report (PDF)', hint: `Print or save as PDF · ${fy}`, disabled: !tax.records.length, onClick: () => setTimeout(() => window.print(), 50) },
    { label: 'Lot-wise statement (CSV)', hint: 'Every sale matched to its purchases', disabled: !tax.records.length, onClick: () => downloadFile(`capital-gains-${slug}.csv`, capitalGainsCsv(tax, navs)) },
    { label: 'Schedule 112A (CSV)', hint: 'Equity LTCG in ITR column order', disabled: !has112A, onClick: () => downloadFile(`schedule-112A-${slug}.csv`, schedule112ACsv(tax, navs)) },
    ...extraItems,
  ];

  return (
    <div className="menu" ref={ref}>
      <button className="btn btn-ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu">
        ⬇ Download ▾
      </button>
      {open && (
        <div className="menu-pop" role="menu">
          {hasSims && <p className="menu-warn">Includes what-if sales. Reset them before exporting for filing.</p>}
          {items.map((it) => (
            <button key={it.label} role="menuitem" className="menu-item" disabled={it.disabled} onClick={run(it.onClick)}>
              <strong>{it.label}</strong>
              <span>{it.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
