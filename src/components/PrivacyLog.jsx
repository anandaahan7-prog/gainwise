import { useMemo, useState, useSyncExternalStore } from 'react';
import { getNetLog, subscribeNetLog } from '../lib/netlog';

const kb = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : b >= 1024 ? `${(b / 1024).toFixed(1)} KB` : `${b} B`);
const time = (t) => new Date(t).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const path = (url) => {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}${u.search.length > 40 ? `${u.search.slice(0, 40)}…` : u.search}`;
  } catch {
    return url;
  }
};

export default function PrivacyLog({ fileName }) {
  const log = useSyncExternalStore(subscribeNetLog, getNetLog);
  const [showApp, setShowApp] = useState(false);

  const { visible, appFiles, totals } = useMemo(() => {
    const app = log.filter((e) => e.group === 'app');
    const rest = log.filter((e) => e.group !== 'app').slice().reverse();
    const bytes = log.reduce((a, e) => a + e.bytes, 0);
    return {
      visible: showApp ? log.slice().reverse() : rest,
      appFiles: { count: app.length, bytes: app.reduce((a, e) => a + e.bytes, 0) },
      totals: { count: log.length, bytes, api: log.filter((e) => e.group === 'api').length, revalidated: log.filter((e) => e.cache === '304 revalidated').length },
    };
  }, [log, showApp]);

  return (
    <div className="privacy">
      <div className="privacy-proof">
        <div className="proof-big">0 bytes</div>
        <p>
          of {fileName ? <strong>{fileName}</strong> : 'your file'} were sent anywhere. It's read inside this browser tab by a
          Python engine running in WebAssembly.
        </p>
      </div>

      <div className="privacy-stats">
        <div><strong>{totals.count}</strong><span>requests</span></div>
        <div><strong>{kb(totals.bytes)}</strong><span>downloaded</span></div>
        <div><strong>{totals.api}</strong><span>to NAV server</span></div>
        <div><strong>{totals.revalidated}</strong><span>answered 304</span></div>
      </div>

      <p className="muted small">
        Every request this page has made, newest first. "What was sent" shows the exact data in each request to the NAV
        server: only public fund names or scheme codes.
      </p>

      <label className="small check">
        <input type="checkbox" checked={showApp} onChange={(e) => setShowApp(e.target.checked)} /> Show the app's own files (
        {appFiles.count} files, {kb(appFiles.bytes)})
      </label>

      <ul className="netlog">
        {visible.length === 0 && <li className="muted small">No external requests yet.</li>}
        {visible.map((e) => (
          <li key={e.id} className={`net-${e.group}`}>
            <div className="net-top">
              <span className="net-label">{e.label}</span>
              <span className={`net-cache ${e.cache.startsWith('304') ? 'hit' : e.cache === 'from cache' ? 'cached' : ''}`}>{e.cache}</span>
            </div>
            <div className="net-url" title={e.url}>{path(e.url)}</div>
            <div className="net-meta">
              {time(e.time)} · {kb(e.bytes)} · {e.ms} ms · {e.source}
            </div>
            {e.sent && <div className="net-sent"><strong>What was sent:</strong> {e.sent}</div>}
          </li>
        ))}
      </ul>
    </div>
  );
}
