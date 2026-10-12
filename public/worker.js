// Python/WASM tax engine. Runs Pyodide + pandas in a background thread.
// The user's file is handed to this worker as raw bytes and never leaves the browser.
importScripts("https://cdn.jsdelivr.net/pyodide/v0.27.7/full/pyodide.js");

const progress = (stage, detail) => self.postMessage({ type: "progress", stage, detail });

// Report this worker's own network requests (Python runtime and packages) to the app's privacy log
if (typeof PerformanceObserver !== "undefined") {
  new PerformanceObserver((list) => {
    const entries = list.getEntries().map((e) => ({
      name: e.name, startTime: e.startTime, duration: e.duration, initiatorType: e.initiatorType,
      transferSize: e.transferSize, encodedBodySize: e.encodedBodySize, decodedBodySize: e.decodedBodySize,
      responseStatus: e.responseStatus, timeOrigin: performance.timeOrigin,
    }));
    self.postMessage({ type: "net", entries });
  }).observe({ type: "resource", buffered: true });
}

let openpyxlReady = null;

const pyodideReady = (async () => {
  progress("runtime", "Downloading the Python runtime (WebAssembly)…");
  const pyodide = await loadPyodide();
  progress("pandas", "Loading pandas…");
  await pyodide.loadPackage(["pandas", "micropip"]);
  // The engine is a plain Python module (also run by the CPython test suite)
  // Always revalidate (ETag/Last-Modified -> usually a 304) so an update is never shadowed by a stale copy
  const engine = await fetch(new URL("engine.py", self.location.href), { cache: "no-cache" });
  if (!engine.ok) throw new Error(`engine.py: HTTP ${engine.status}`);
  await pyodide.runPythonAsync(await engine.text());
  progress("ready", "Engine ready");
  return pyodide;
})();

pyodideReady.catch((err) => {
  self.postMessage({ type: "boot-error", error: `Couldn't start the Python engine: ${err.message}` });
});

let pypdfReady = null;

self.onmessage = async (event) => {
  // The CAS password (if any) stays inside this worker and is never stored or sent anywhere
  const { type, kind, buffer, password } = event.data;
  if (type !== "parse") return;
  try {
    const pyodide = await pyodideReady;
    if (kind === "xlsx") {
      if (!openpyxlReady) {
        progress("xlsx", "Installing the Excel reader (openpyxl)…");
        const micropip = pyodide.pyimport("micropip");
        openpyxlReady = micropip.install("openpyxl");
      }
      await openpyxlReady;
    }
    if (kind === "pdf") {
      if (!pypdfReady) {
        progress("pdf", "Installing the PDF reader (pypdf)…");
        pypdfReady = (async () => {
          await pyodide.loadPackage("cryptography"); // decrypts password-protected statements
          const micropip = pyodide.pyimport("micropip");
          // PyPI downloads occasionally fail; retry once before giving up
          for (let attempt = 1; ; attempt++) {
            try {
              await micropip.install("pypdf==6.18.1");
              return;
            } catch {
              if (attempt >= 2) throw new Error("Couldn't download the PDF reader (pypdf). Check your internet connection and try again.");
            }
          }
        })();
        pypdfReady.catch(() => (pypdfReady = null));
      }
      await pypdfReady;
    }
    progress("parse", "Parsing transactions and matching lots FIFO…");
    const runEngine = pyodide.globals.get("run_engine_safe");
    const result = JSON.parse(runEngine(kind, new Uint8Array(buffer), password || null));
    runEngine.destroy();
    if (result.error) self.postMessage({ type: "error", error: result.error });
    else self.postMessage({ type: "result", data: result });
  } catch (error) {
    // Python tracebacks are long; keep the final line (the actual message)
    let msg = String(error.message || error).trim().split("\n").filter(Boolean).pop() ?? "";
    if (/formatting traceback/i.test(msg)) msg = `The engine failed (${error.type || "unknown error"}). Please try again.`;
    self.postMessage({ type: "error", error: msg.replace(/^\w+Error: /, "") });
  }
};
