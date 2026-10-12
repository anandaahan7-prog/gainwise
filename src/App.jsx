import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import Header from './components/Header';
import Upload, { Loading } from './components/Upload';
import NavCards from './components/NavCards';
import TaxReport from './components/TaxReport';
import Portfolio from './components/Portfolio';
import SaveTax from './components/SaveTax';
import DownloadMenu from './components/DownloadMenu';
import PrintReport from './components/PrintReport';
import Drawer from './components/Drawer';
import PrivacyLog from './components/PrivacyLog';
import Assistant from './components/Assistant';
import { startEngine, subscribeEngine, getEngineState, parseFile } from './lib/engine';
import { startNetLog, subscribeNetLog, getNetLog } from './lib/netlog';
import { resolveClasses } from './lib/classify';
import { buildModel } from './lib/portfolio';
import { buildActions } from './lib/actions';
import { taxDates, buildIcs } from './lib/calendar';
import { downloadFile } from './lib/report';
import { fetchNavs, fetchFmv2018 } from './lib/nav';
import { shortFund } from './lib/format';
import { usePersistentState } from './lib/storage';

const SLABS = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3];
let simSeq = 0;

export default function App() {
  const engine = useSyncExternalStore(subscribeEngine, getEngineState);
  const netlog = useSyncExternalStore(subscribeNetLog, getNetLog);
  const [theme, setTheme] = usePersistentState('theme', 'system');
  const [slab, setSlab] = usePersistentState('slab', 0.3);
  const [overrides, setOverrides] = usePersistentState('overrides', {});
  const [autoNav, setAutoNav] = usePersistentState('autoNav', true);
  // Only scheme codes the user typed in are remembered; automatic matches are redone on every
  // fetch so an improved matcher (or a renamed scheme) is never shadowed by a stale guess.
  const [manualCodes, setManualCodes] = usePersistentState('manualSchemeCodes', {});

  const [phase, setPhase] = useState('upload');
  const [fileName, setFileName] = useState('');
  const [fileKind, setFileKind] = useState('csv');
  const [error, setError] = useState(null);
  const [pendingPdf, setPendingPdf] = useState(null);
  const [passwordError, setPasswordError] = useState(null);
  const [raw, setRaw] = useState(null);
  const [navs, setNavs] = useState({});
  const [navStatus, setNavStatus] = useState({ loading: false, done: 0, total: 0, errors: {} });
  const [sims, setSims] = useState([]);
  const [fy, setFy] = useState(null);
  // Losses brought forward from earlier ITRs, per financial year. In memory only (never stored).
  const [bfLosses, setBfLosses] = useState({});
  const [view, setView] = useState('report');
  const [askOpen, setAskOpen] = useState(false);
  const [askMounted, setAskMounted] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const autoFetchedFor = useRef(null);

  useEffect(() => {
    startNetLog();
    startEngine();
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = theme;
  }, [theme]);

  const handleFile = useCallback(async (file, password) => {
    const kind = /\.pdf$/i.test(file.name) ? 'pdf' : /\.xlsx?$/i.test(file.name) ? 'xlsx' : 'csv';
    if (kind === 'pdf' && password === undefined) {
      // Ask for the CAS password first (it is never stored)
      setPendingPdf(file);
      setPasswordError(null);
      setError(null);
      return;
    }
    setPendingPdf(null);
    setFileName(file.name);
    setFileKind(kind);
    setError(null);
    setPhase('loading');
    try {
      const data = await parseFile(await file.arrayBuffer(), kind, password || null);
      if (!data.matches.length && !data.holdings.length) throw new Error('No purchase or redemption transactions were found in this file.');
      setRaw(data);
      setNavs({});
      setNavStatus({ loading: false, done: 0, total: 0, errors: {} });
      setSims([]);
      setFy(null);
      setBfLosses({});
      setView('report');
      setPhase('results');
    } catch (e) {
      if (e.message.startsWith('PASSWORD:')) {
        setPendingPdf(file);
        setPasswordError(e.message.replace(/^PASSWORD:\s*/, ''));
      } else {
        setError(e.message);
      }
      setPhase('upload');
    }
  }, []);

  const reset = () => {
    setRaw(null);
    setPhase('upload');
    setSims([]);
    setNavs({});
    autoFetchedFor.current = null;
  };

  const classes = useMemo(() => (raw ? resolveClasses(raw.funds, overrides, navs) : {}), [raw, overrides, navs]);
  const model = useMemo(() => (raw ? buildModel({ raw, classes, navs, sims, slab, bfLosses }) : null), [raw, classes, navs, sims, slab, bfLosses]);
  // Same data without what-if sales: the Save tax ideas are computed on this, so previews don't reshuffle them
  const baseModel = useMemo(() => (raw ? buildModel({ raw, classes, navs, sims: [], slab, bfLosses }) : null), [raw, classes, navs, slab, bfLosses]);
  const plan = useMemo(() => (baseModel ? buildActions(baseModel) : null), [baseModel]);
  const dates = useMemo(() => (baseModel && plan ? taxDates(baseModel, plan) : []), [baseModel, plan]);

  // Default to the most recent FY that actually has sales
  const latestFy = model ? model.realized.reduce((m, r) => Math.max(m, r.fy), -Infinity) : null;
  const selectedFy = fy ?? (Number.isFinite(latestFy) ? latestFy : model?.currentFy);
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
    // Every fund: held ones need prices, sold ones still benefit from the official AMFI category
    const list = names ?? model.funds.map((f) => f.name);
    if (!list.length) return;
    setNavStatus({ loading: true, done: 0, total: list.length, errors: {} });
    try {
      const { results, errors, via } = await fetchNavs(list, manualCodes, (done, total) => setNavStatus((s) => ({ ...s, done, total })));
      const enriched = await withFmv(results);
      setNavs((n) => ({ ...n, ...enriched }));
      // Funds that are fully sold don't need a price, so don't nag about them
      const heldNames = new Set(model.funds.filter((f) => f.units > 1e-6).map((f) => f.name));
      const relevant = Object.fromEntries(Object.entries(errors).filter(([f]) => heldNames.has(f)));
      setNavStatus({ loading: false, done: list.length, total: list.length, errors: relevant, via });
    } catch (e) {
      setNavStatus({ loading: false, done: 0, total: list.length, errors: Object.fromEntries(list.map((f) => [f, e.message])) });
    }
  };

  // Prices load automatically: only public fund names leave the browser (see the privacy log)
  useEffect(() => {
    if (phase === 'results' && raw && autoNav && autoFetchedFor.current !== raw) {
      autoFetchedFor.current = raw;
      fetchLive();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, raw, autoNav]);

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

  const addSim = (s) => setSims((list) => [...list, { id: `manual-${++simSeq}`, action: 'manual', date: model.today, ...s }]);

  const openAsk = () => {
    setAskMounted(true);
    setAskOpen(true);
  };

  const unknown = model ? model.funds.filter((f) => f.assetClass === 'Unknown') : [];
  const held = model ? model.funds.filter((f) => f.units > 1e-6) : [];
  const priced = held.filter((f) => f.value != null);
  const worth = priced.length ? priced.reduce((a, f) => a + f.value, 0) : null;
  const externalRequests = netlog.filter((e) => e.group !== 'app').length;

  return (
    <>
      <Header
        theme={theme}
        setTheme={setTheme}
        onHome={phase === 'results' ? reset : undefined}
        onPrivacy={() => setPrivacyOpen(true)}
        requestCount={externalRequests}
      />
      <main className="container">
        {phase === 'upload' && (
          <Upload
            engine={engine}
            error={error}
            onFile={handleFile}
            pendingPdf={pendingPdf}
            passwordError={passwordError}
            onPassword={(pw) => handleFile(pendingPdf, pw)}
            onCancelPdf={() => setPendingPdf(null)}
          />
        )}
        {phase === 'loading' && <Loading engine={engine} kind={fileKind} fileName={fileName} />}
        {phase === 'results' && model && (
          <>
            <div className="toolbar no-print">
              <div className="toolbar-title">
                <h1>{fileName}</h1>
                <p>
                  {raw.stats.rows} transactions · {model.funds.length} funds
                </p>
              </div>
              <div className="toolbar-controls">
                <label className="field inline">
                  Income slab
                  <select className="select" value={slab} onChange={(e) => setSlab(parseFloat(e.target.value))}>
                    {SLABS.map((s) => (
                      <option key={s} value={s}>
                        {Math.round(s * 100)}%
                      </option>
                    ))}
                  </select>
                </label>
                <DownloadMenu
                  tax={tax}
                  navs={navs}
                  extraItems={[{
                    label: 'Tax reminders (.ics)',
                    hint: `${dates.length} upcoming date${dates.length === 1 ? '' : 's'} for your calendar`,
                    disabled: !dates.length,
                    onClick: () => downloadFile('gainwise-tax-dates.ics', buildIcs(dates), 'text/calendar;charset=utf-8'),
                  }]}
                />
                <button className="btn btn-ghost" onClick={openAsk}>✦ Ask</button>
                <button className="btn btn-ghost" onClick={reset}>New file</button>
              </div>
            </div>

            <NavCards
              view={view}
              setView={setView}
              reportTax={tax}
              worth={worth}
              invested={held.reduce((a, f) => a + f.cost, 0)}
              saveTotal={plan?.total}
              navLoading={navStatus.loading}
            />

            {unknown.length > 0 && !navStatus.loading && (
              <div className="banner warn no-print">
                <span>⚠️</span>
                <div className="banner-body">
                  <strong>{unknown.length === 1 ? '1 fund needs' : `${unknown.length} funds need`} a tax type</strong>
                  {unknown.map((f) => (
                    <div key={f.name} className="banner-row">
                      <span>{shortFund(f.name)}</span>
                      {['Equity', 'Debt', 'Other'].map((c) => (
                        <button key={c} className="btn btn-ghost btn-sm" onClick={() => setOverride(f.name, c)}>{c}</button>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {sims.length > 0 && view !== 'save' && (
              <div className="banner info no-print">
                <span>🧪</span>
                <div className="banner-body">
                  <strong>Including {sims.length} what-if sale{sims.length > 1 ? 's' : ''}</strong> in this year's numbers.
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => setView('save')}>Review</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setSims([])}>Reset</button>
              </div>
            )}

            <div className="no-print">
              {view === 'report' && <TaxReport
                  model={model}
                  tax={tax}
                  fy={selectedFy}
                  setFy={setFy}
                  warnings={raw.warnings}
                  goTo={setView}
                  bf={bfLosses[selectedFy] ?? { st: 0, lt: 0 }}
                  setBf={(v) => setBfLosses((all) => ({ ...all, [selectedFy]: v }))}
                />}
              {view === 'portfolio' && (
                <Portfolio
                  model={model}
                  navStatus={navStatus}
                  autoNav={autoNav}
                  setAutoNav={setAutoNav}
                  onFetch={fetchLive}
                  onOverride={setOverride}
                  onNav={setManualNav}
                  onSchemeCode={setSchemeCode}
                  onAddSim={addSim}
                />
              )}
              {view === 'save' && <SaveTax plan={plan} dates={dates} baseModel={baseModel} model={model} sims={sims} setSims={setSims} navStatus={navStatus} />}
            </div>

            <PrintReport model={model} tax={tax} />

            {askMounted && (
              <Drawer open={askOpen} onClose={() => setAskOpen(false)} title="✦ Ask about your taxes" wide>
                <Assistant model={model} tax={tax} />
              </Drawer>
            )}
          </>
        )}
      </main>
      <Drawer open={privacyOpen} onClose={() => setPrivacyOpen(false)} title="🔒 Privacy log">
        <PrivacyLog fileName={phase === 'results' ? fileName : null} />
      </Drawer>
    </>
  );
}
