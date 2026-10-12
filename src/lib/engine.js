import { addWorkerEntries } from './netlog';

// Singleton wrapper around the Pyodide worker. The worker boots as soon as the page
// loads so the ~10 MB Python runtime is usually ready by the time a file is chosen.
let worker = null;
let state = { stage: 'idle', detail: '', ready: false, bootError: null };
const listeners = new Set();
let pending = null;

const emit = (patch) => {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn(state));
};

export function startEngine() {
  if (worker) return;
  worker = new Worker('/worker.js');
  emit({ stage: 'runtime', detail: 'Starting the Python engine…' });
  worker.onmessage = ({ data }) => {
    if (data.type === 'net') {
      addWorkerEntries(data.entries);
    } else if (data.type === 'progress') {
      emit({ stage: data.stage, detail: data.detail, ready: state.ready || data.stage === 'ready' });
    } else if (data.type === 'boot-error') {
      emit({ bootError: data.error });
      pending?.reject(new Error(data.error));
      pending = null;
    } else if (data.type === 'result') {
      pending?.resolve(data.data);
      pending = null;
    } else if (data.type === 'error') {
      pending?.reject(new Error(data.error));
      pending = null;
    }
  };
  worker.onerror = (e) => {
    emit({ bootError: e.message || 'The engine worker crashed.' });
    pending?.reject(new Error(state.bootError));
    pending = null;
  };
}

export const getEngineState = () => state;

export function subscribeEngine(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function parseFile(buffer, kind) {
  startEngine();
  if (state.bootError) return Promise.reject(new Error(state.bootError));
  return new Promise((resolve, reject) => {
    pending = { resolve, reject };
    worker.postMessage({ type: 'parse', kind, buffer }, [buffer]);
  });
}
