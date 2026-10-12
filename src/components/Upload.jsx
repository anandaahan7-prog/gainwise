import { useState } from 'react';

const ACCEPT = '.csv,.xlsx,.xls,.pdf';

// CAS PDFs are password-protected (usually the PAN). The password goes straight to the worker.
function PasswordPrompt({ file, error, onSubmit, onCancel }) {
  const [password, setPassword] = useState('');
  return (
    <form
      className="panel password-prompt"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(password.trim());
      }}
    >
      <div>
        <h2>🔐 Unlock {file.name}</h2>
        <p className="muted small">
          CAS statements from CAMS, KFintech and MF Central are protected with a password, usually your PAN in capital letters.
          It's used only inside this tab to open the PDF and is never stored or sent anywhere. Leave it empty if the PDF has no password.
        </p>
      </div>
      <input
        className="input"
        type="password"
        autoComplete="off"
        autoFocus
        placeholder="e.g. ABCDE1234F"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        aria-label="PDF password"
      />
      {error && <p className="neg small">{error}</p>}
      <div className="password-actions">
        <button className="btn" type="submit">Open statement</button>
        <button className="btn btn-ghost" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

export default function Upload({ engine, error, onFile, pendingPdf, passwordError, onPassword, onCancelPdf }) {
  const [drag, setDrag] = useState(false);

  const pick = (files) => {
    const file = files?.[0];
    if (file) onFile(file);
  };

  return (
    <>
      <section className="hero">
        <h1>
          Mutual fund capital gains,
          <br />
          <em>calculated privately.</em>
        </h1>
        <p>
          Upload your Groww order history. A Python engine running inside your browser matches every redemption FIFO, applies the
          current Indian tax rules and finds ways to pay less tax. Nothing is uploaded.
        </p>
      </section>

      <label
        className={`dropzone ${drag ? 'drag' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          pick(e.dataTransfer.files);
        }}
      >
        <div className="dropzone-icon">
          <svg width="26" height="26" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
        </div>
        <h2>Drop your transaction file here</h2>
        <p>Groww order history (CSV or Excel), or a CAS PDF from CAMS, KFintech or MF Central</p>
        <div className="actions">
          <span className="btn btn-lg">Choose file</span>
        </div>
        <input
          type="file"
          accept={ACCEPT}
          className="file-input"
          onChange={(e) => {
            pick(e.target.files);
            e.target.value = ''; // so choosing the same file again still triggers a load
          }}
        />
      </label>

      {pendingPdf && <PasswordPrompt key={pendingPdf.name + (passwordError ?? '')} file={pendingPdf} error={passwordError} onSubmit={onPassword} onCancel={onCancelPdf} />}

      <div style={{ textAlign: 'center' }}>
        <EngineStatus engine={engine} />
      </div>

      {error && (
        <div className="alert bad" style={{ maxWidth: 680, margin: '20px auto 0' }}>
          <span className="alert-icon">⚠️</span>
          <div>
            <strong>Couldn't read that file</strong>
            <p>{error}</p>
          </div>
        </div>
      )}

      <section className="features">
        <div className="feature">
          <div className="feature-icon">🔒</div>
          <h3>Zero egress</h3>
          <p>Pyodide (Python compiled to WebAssembly) runs pandas in a Web Worker. Your file stays in this tab's memory.</p>
        </div>
        <div className="feature">
          <div className="feature-icon">⚖️</div>
          <h3>Rules for every year</h3>
          <p>Pre/post 23 Jul 2024 rates, Section 50AA debt rules, loss set-off, ₹1.25L exemption and 4% cess, per financial year.</p>
        </div>
        <div className="feature">
          <div className="feature-icon">🌱</div>
          <h3>Pay less, legally</h3>
          <p>Gain-harvesting plans, loss-harvesting candidates, "wait N days" alerts and an on-device AI assistant.</p>
        </div>
      </section>
    </>
  );
}

export function EngineStatus({ engine }) {
  if (engine.bootError) {
    return (
      <span className="engine-status">
        <span className="dot err" /> Python engine failed to load. Check your connection and refresh.
      </span>
    );
  }
  return (
    <span className="engine-status">
      <span className={`dot ${engine.ready ? 'ready' : 'pulse'}`} />
      {engine.ready ? 'Python engine ready' : `${engine.detail || 'Warming up the Python engine…'}`}
    </span>
  );
}

const STEPS = [
  { id: 'runtime', label: 'Download Python runtime (WebAssembly)' },
  { id: 'pandas', label: 'Load pandas' },
  { id: 'xlsx', label: 'Install Excel reader', only: 'xlsx' },
  { id: 'pdf', label: 'Install PDF reader', only: 'pdf' },
  { id: 'parse', label: 'Parse file and match lots FIFO' },
];

export function Loading({ engine, kind, fileName }) {
  const steps = STEPS.filter((s) => !s.only || s.only === kind);
  const order = steps.map((s) => s.id);
  const stage = engine.stage === 'ready' ? (kind === 'xlsx' || kind === 'pdf' ? kind : 'parse') : engine.stage;
  const current = Math.max(order.indexOf(stage), 0);
  return (
    <div className="loading" role="status" aria-live="polite">
      <h2>Crunching {fileName}</h2>
      <ol className="steps">
        {steps.map((s, i) => (
          <li key={s.id} className={`step ${i < current ? 'done' : i === current ? 'active' : ''}`}>
            <span className="step-mark">{i < current ? '✓' : ''}</span>
            {s.label}
          </li>
        ))}
      </ol>
      <p className="muted small" style={{ marginTop: 18 }}>
        First run downloads ~15 MB of Python and pandas. After that the browser caches them.
      </p>
    </div>
  );
}
