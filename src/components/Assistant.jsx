import { useEffect, useRef, useState } from 'react';
import { MODELS, detectWebGPU, modelId, isCached, loadEngine, streamChat } from '../ai/llm';
import { buildContext, SYSTEM_PROMPT, SUGGESTIONS } from '../ai/context';
import { usePersistentState } from '../lib/storage';

export default function Assistant({ model, tax }) {
  const [gpu, setGpu] = useState(null);
  const [choice, setChoice] = usePersistentState('aiModel', MODELS[0].base);
  const [cached, setCached] = useState({});
  const [status, setStatus] = useState('idle'); // idle | loading | ready | error
  const [progress, setProgress] = useState({ progress: 0, text: '' });
  const [error, setError] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [showContext, setShowContext] = useState(false);
  const engineRef = useRef(null);
  const logRef = useRef(null);

  useEffect(() => {
    detectWebGPU().then(async (g) => {
      setGpu(g);
      if (!g.ok) return;
      const entries = await Promise.all(MODELS.map(async (m) => [m.base, await isCached(modelId(m.base, g.f16))]));
      setCached(Object.fromEntries(entries));
    });
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages]);

  const start = async () => {
    setStatus('loading');
    setError(null);
    try {
      engineRef.current = await loadEngine(modelId(choice, gpu.f16), (p) => setProgress(p));
      setCached((c) => ({ ...c, [choice]: true }));
      setStatus('ready');
    } catch (e) {
      setError(e.message || String(e));
      setStatus('error');
    }
  };

  const ask = async (text) => {
    const q = text.trim();
    if (!q || busy || !engineRef.current) return;
    setInput('');
    const history = [...messages, { role: 'user', content: q }];
    setMessages([...history, { role: 'assistant', content: '' }]);
    setBusy(true);
    try {
      const prompt = [
        { role: 'system', content: `${SYSTEM_PROMPT}\n\nPORTFOLIO DATA:\n${buildContext(model, tax)}` },
        ...history.slice(-6),
      ];
      let out = '';
      for await (const delta of streamChat(engineRef.current, prompt)) {
        out += delta;
        setMessages([...history, { role: 'assistant', content: out }]);
      }
    } catch (e) {
      setMessages([...history, { role: 'assistant', content: `⚠️ ${e.message || e}` }]);
    } finally {
      setBusy(false);
    }
  };

  const stop = () => engineRef.current?.interruptGenerate();

  if (gpu === null) return <section className="panel"><div className="empty"><span className="spinner" /> Checking for WebGPU…</div></section>;

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>✦ Private AI tax assistant</h2>
            <p>
              A small language model runs on your GPU inside this tab via WebLLM. It reads a summary of the numbers on this page; your
              questions and data are never sent anywhere. The model weights download once and are cached.
            </p>
          </div>
          {status === 'ready' && (
            <button className="btn btn-ghost btn-sm" onClick={() => setShowContext((s) => !s)}>
              {showContext ? 'Hide' : 'Show'} what the AI sees
            </button>
          )}
        </div>

        {!gpu.ok && (
          <div className="alert warn">
            <span className="alert-icon">🖥️</span>
            <div>
              <strong>On-device AI isn't available here</strong>
              <p>{gpu.reason} The Insights panel on the Overview tab still gives you rule-based tips.</p>
            </div>
          </div>
        )}

        {gpu.ok && status !== 'ready' && (
          <>
            <div className="model-list" role="radiogroup" aria-label="Choose a model">
              {MODELS.map((m) => (
                <button
                  key={m.base}
                  role="radio"
                  aria-checked={choice === m.base}
                  className={`model-card ${choice === m.base ? 'selected' : ''}`}
                  onClick={() => setChoice(m.base)}
                  disabled={status === 'loading'}
                >
                  <strong>
                    {m.name} {m.recommended && <span className="badge lt">Recommended</span>}
                  </strong>
                  <span>{cached[m.base] ? 'Downloaded · loads in seconds' : m.note}</span>
                </button>
              ))}
            </div>
            {status === 'loading' ? (
              <div>
                <div className="progress" aria-label="Model loading progress">
                  <div style={{ width: `${Math.round((progress.progress || 0) * 100)}%` }} />
                </div>
                <p className="muted small" style={{ marginTop: 8 }}>{progress.text || 'Preparing…'}</p>
              </div>
            ) : (
              <button className="btn btn-lg" onClick={start}>
                {cached[choice] ? 'Start assistant' : 'Download & start assistant'}
              </button>
            )}
            {error && (
              <div className="alert bad" style={{ marginTop: 14 }}>
                <span className="alert-icon">⚠️</span>
                <div>
                  <strong>The model couldn't load</strong>
                  <p>{error}. A smaller model may fit your GPU memory better.</p>
                </div>
              </div>
            )}
          </>
        )}

        {status === 'ready' && showContext && (
          <pre className="small" style={{ whiteSpace: 'pre-wrap', background: 'var(--surface-2)', padding: 12, borderRadius: 10, maxHeight: 300, overflow: 'auto', marginBottom: 16 }}>
            {buildContext(model, tax)}
          </pre>
        )}

        {status === 'ready' && (
          <div className="chat">
            <div className="chat-log" ref={logRef} aria-live="polite">
              {messages.length === 0 && (
                <>
                  <p className="muted">Ask anything about your gains, tax or holdings. Try one of these:</p>
                  <div className="chips">
                    {SUGGESTIONS.map((s) => (
                      <button key={s} className="chip" onClick={() => ask(s)}>{s}</button>
                    ))}
                  </div>
                </>
              )}
              {messages.map((m, i) => (
                <div key={i} className={`msg ${m.role}`}>
                  {m.content || <span className="spinner" />}
                </div>
              ))}
            </div>
            <form
              className="chat-input"
              onSubmit={(e) => {
                e.preventDefault();
                ask(input);
              }}
            >
              <textarea
                rows={1}
                value={input}
                placeholder="Ask about your taxes…"
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    ask(input);
                  }
                }}
              />
              {busy ? (
                <button type="button" className="btn btn-ghost" onClick={stop}>Stop</button>
              ) : (
                <button type="submit" className="btn" disabled={!input.trim()}>Send</button>
              )}
            </form>
            <p className="muted small" style={{ marginTop: 8 }}>
              Small models can make mistakes. Check figures against the tax computation before acting.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
