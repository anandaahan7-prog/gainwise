import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import Header from './components/Header';
import Upload, { Loading } from './components/Upload';
import Overview from './components/Overview';
import Realized from './components/Realized';
import Holdings from './components/Holdings';
import Planner from './components/Planner';
import Report from './components/Report';
import Assistant from './components/Assistant';
import { startEngine, subscribeEngine, getEngineState, parseFile } from './lib/engine';
import { resolveClasses } from './lib/classify';
import { buildModel } from './lib/portfolio';
import { fetchNavs, fetchFmv2018 } from './lib/nav';
import { fyLabel } from './lib/dates';
import { usePersistentState } from './lib/storage';

const SLABS = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3];

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'realized', label: 'Realized gains' },
  { id: 'holdings', label: 'Funds & holdings' },
  { id: 'planner', label: 'Tax planner' },
  { id: 'report', label: 'Export' },
  { id: 'assistant', label: 'AI assistant ✦' },
];

export default function App() {
  const engine = useSyncExternalStore(subscribeEngine, getEngineState);
  const [theme, setTheme] = usePersistentState('theme', 'system');
  const [slab, setSlab] = usePersistentState('slab', 0.3);
  const [overrides, setOverrides] = usePersistentState('overrides', {});
  // Only scheme codes the user typed in are remembered; automatic matches are redone on every
  // fetch so an improved matcher (or a renamed scheme) is never shadowed by a stale guess.
  const [manualCodes, setManualCodes] = usePersistentState('manualSchemeCodes', {});

  const [phase, setPhase] = useState('upload');
  const [fileName, setFileName] = useState('');
  const [fileKind, setFileKind] = useState('csv');
  const [error, setError] = useState(null);
  const [raw, setRaw] = useState(null);
  const [navs, setNavs] = useState({});
  const [navStatus, setNavStatus] = useState({ loading: false, done: 0, total: 0, errors: {} });
  const [sims, setSims] = useState([]);
  const [fy, setFy] = useState(null);
  const [tab, setTabState] = useState('overview');
  const [aiOpened, setAiOpened] = useState(false);
  const setTab = useCallback((t) => {
    setTabState(t);
    if (t === 'assistant') setAiOpened(true);
  }, []);

  useEffect(() => startEngine(), []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = theme;
  }, [theme]);

  const handleFile = useCallback(async (file) => {
    const kind = /\.xlsx?$/i.test(file.name) ? 'xlsx' : 'csv';
    setFileName(file.name);
    setFileKind(kind);
    setError(null);
    setPhase('loading');
    try {
      const data = await parseFile(await file.arrayBuffer(), kind);
      if (!data.matches.length && !data.holdings.length) throw new Error('No purchase or redemption transactions were found in this file.');
      setRaw(data);
      setNavs({});
      setNavStatus({ loading: false, done: 0, total: 0, errors: {} });
      setSims([]);
      setFy(null);
      setTab('overview');
      setPhase('results');
    } catch (e) {
      setError(e.message);
      setPhase('upload');
    }
  }, [setTab]);

  const reset = () => {
    setRaw(null);
    setPhase('upload');
    setSims([]);
    setNavs({});
  };

  const classes = useMemo(() => (raw ? resolveClasses(raw.funds, overrides, navs) : {}), [raw, overrides, navs]);
  const model = useMemo(() => (raw ? buildModel({ raw, classes, navs, sims, slab }) : null), [raw, classes, navs, sims, slab]);

  // Default to the most recent FY that actually has sales
  const activeFy = fy ?? (model ? model.realized.reduce((m, r) => Math.max(m, r.fy), -Infinity) : null);
  const selectedFy = model && Number.isFinite(activeFy) ? activeFy : model?.currentFy;
  const tax = useMemo(() => (model ? model.taxFor(selectedFy) : null), [model, selectedFy]);

  const setOverride = (fund, cls) =>
    setOverrides((o) => {
      const next = { ...o };
      if (cls) next[fund] = cls;
      else delete next[fund];
      return next;
    });

  const setManualNav = (fund, nav) =>
    setNavs((n) => {
      const next = { ...n };
      if (nav > 0) next[fund] = { ...(n[fund] ?? {}), nav, navDate: model.today, source: n[fund]?.source === 'live' && n[fund]?.nav === nav ? 'live' : 'manual' };
      else delete next[fund];
      return next;
    });

  // Attach the 31 Jan 2018 NAV to funds holding pre-2018 equity units (Sec 112A grandfathering)
  const withFmv = async (results) => {
    const targets = Object.entries(results).filter(([f]) => model.needsFmv.includes(f));
    if (!targets.length) return results;
    const fmv = await fetchFmv2018(targets.map(([, r]) => r.schemeCode)).catch(() => ({}));
    const out = { ...results };
    for (const [f, r] of targets) if (fmv[r.schemeCode]) out[f] = { ...r, fmv2018: fmv[r.schemeCode] };
    return out;
  };

  const fetchLive = async (names) => {
    // Held funds, plus fully-sold ones whose pre-2018 units need an FMV for past years' tax
    const list = names ?? model.funds.filter((f) => f.units > 0 || model.needsFmv.includes(f.name)).map((f) => f.name);
    if (!list.length) return;
    setNavStatus({ loading: true, done: 0, total: list.length, errors: {} });
    try {
      const { results, errors, via } = await fetchNavs(list, manualCodes, (done, total) =>
        setNavStatus((s) => ({ ...s, done, total })),
      );
      const enriched = await withFmv(results);
      setNavs((n) => ({ ...n, ...enriched }));
      setNavStatus({ loading: false, done: list.length, total: list.length, errors, via });
    } catch (e) {
      setNavStatus({ loading: false, done: 0, total: list.length, errors: Object.fromEntries(list.map((f) => [f, e.message])) });
    }
  };

  const setSchemeCode = async (fund, code) => {
    setManualCodes((c) => ({ ...c, [fund]: code }));
    setNavStatus((s) => ({ ...s, loading: true }));
    const { results: fetched, errors } = await fetchNavs([fund], { [fund]: code });
    const results = await withFmv(fetched);
    setNavs((n) => ({ ...n, ...results }));
    setNavStatus((s) => {
      const e = { ...s.errors };
      delete e[fund];
      return { ...s, loading: false, errors: { ...e, ...errors } };
    });
  };

  const unknownCount = model ? model.funds.filter((f) => f.assetClass === 'Unknown').length : 0;

  return (
    <>
      <Header theme={theme} setTheme={setTheme} onHome={phase === 'results' ? reset : undefined} />
      <main className="container">
        {phase === 'upload' && <Upload engine={engine} error={error} onFile={handleFile} />}
        {phase === 'loading' && <Loading engine={engine} kind={fileKind} fileName={fileName} />}
        {phase === 'results' && model && (
          <>
            <div className="toolbar no-print">
              <div className="toolbar-title">
                <h1>Capital gains · {fyLabel(selectedFy)}</h1>
                <p>
                  {fileName} · {raw.stats.rows} transactions · {model.funds.length} funds
                </p>
              </div>
              <div className="toolbar-controls">
                <label className="field">
                  Financial year
                  <select className="select" value={selectedFy} onChange={(e) => setFy(Number(e.target.value))}>
                    {model.fys.map((y) => (
                      <option key={y} value={y}>
                        {fyLabel(y)}
                        {y === model.currentFy ? ' (current)' : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  Your income slab
                  <select className="select" value={slab} onChange={(e) => setSlab(parseFloat(e.target.value))}>
                    {SLABS.map((s) => (
                      <option key={s} value={s}>
                        {Math.round(s * 100)}%
                      </option>
                    ))}
                  </select>
                </label>
                <button className="btn btn-ghost" onClick={reset}>
                  New file
                </button>
              </div>
            </div>

            <nav className="tabs no-print" role="tablist">
              {TABS.map((t) => (
                <button key={t.id} role="tab" aria-selected={tab === t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
                  {t.label}
                  {t.id === 'holdings' && unknownCount > 0 && <span className="tab-count">{unknownCount}</span>}
                  {t.id === 'planner' && sims.length > 0 && <span className="tab-count">{sims.length}</span>}
                </button>
              ))}
            </nav>

            {tab === 'overview' && <Overview model={model} tax={tax} warnings={raw.warnings} goTo={setTab} />}
            {tab === 'realized' && <Realized model={model} tax={tax} />}
            {tab === 'holdings' && (
              <Holdings
                model={model}
                navStatus={navStatus}
                onFetch={fetchLive}
                onOverride={setOverride}
                onNav={setManualNav}
                onSchemeCode={setSchemeCode}
              />
            )}
            {tab === 'planner' && <Planner model={model} sims={sims} setSims={setSims} onFetch={fetchLive} navStatus={navStatus} goTo={setTab} />}
            {tab === 'report' && <Report model={model} tax={tax} navs={navs} />}
            {/* Kept mounted so a loaded model and chat survive tab switches */}
            {aiOpened && (
              <div hidden={tab !== 'assistant'}>
                <Assistant model={model} tax={tax} />
              </div>
            )}
          </>
        )}
      </main>
    </>
  );
}
