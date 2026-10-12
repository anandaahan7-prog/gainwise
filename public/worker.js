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

const PYTHON_ENGINE = `
import io, csv, json, re
import pandas as pd

# ---------------------------------------------------------------------------
# Asset classification heuristics (fallback when no AMFI category is known).
# Order matters: specific debt/gold patterns are checked before generic
# equity words, so "Nifty SDL Index" or "Gilt Index" are not tagged Equity.
# ---------------------------------------------------------------------------
DEBT_PATTERNS = [
    "liquid", "debt", "gilt", "bond", "corporate", "money market", "overnight",
    "duration", "credit risk", "banking and psu", "banking & psu", "floater",
    "floating rate", "sdl", "g-sec", "gsec", "treasury", "income fund",
    "crisil ibx", "target maturity", "fixed maturity", "fmp", "savings fund",
    "dynamic bond", "medium term", "short term", "ultra short", "low duration",
    "conservative hybrid",
]
OTHER_PATTERNS = [
    "gold", "silver", "international", "overseas", "global", "us equity",
    "nasdaq", "s&p 500", "fof", "fund of fund", "feeder", "multi asset",
    "commodit",
]
EQUITY_PATTERNS = [
    "equity", "bluechip", "blue chip", "large cap", "largecap", "mid cap",
    "midcap", "small cap", "smallcap", "multi cap", "multicap", "flexi cap",
    "flexicap", "focused", "value", "contra", "dividend yield", "elss",
    "tax saver", "taxsaver", "nifty", "sensex", "next 50", "large & mid",
    "large and mid", "arbitrage", "psu", "infrastructure", "pharma",
    "healthcare", "technology", "digital", "consumption", "consumer", "banking",
    "financial services", "manufacturing", "momentum", "quality", "alpha",
    "low volatility", "thematic", "sectoral", "business cycle",
    "aggressive hybrid", "equity savings", "opportunities", "innovation",
    "special situations", "esg", "mnc", "energy", "auto", "fmcg", "realty",
    "index",
]

def classify(name):
    n = name.lower()
    for kw in DEBT_PATTERNS:
        if kw in n:
            return "Debt", kw
    for kw in OTHER_PATTERNS:
        if kw in n:
            return "Other", kw
    for kw in EQUITY_PATTERNS:
        if kw in n:
            return "Equity", kw
    return "Unknown", None

BUY_TYPES = {"PURCHASE", "BUY", "SIP", "SWITCH IN", "SWITCH-IN", "SWITCHIN",
             "STP IN", "STP-IN", "DIVIDEND REINVEST", "IDCW REINVEST",
             "ADDITIONAL PURCHASE", "NEW PURCHASE", "SYSTEMATIC INVESTMENT"}
SELL_TYPES = {"REDEEM", "REDEMPTION", "SELL", "SWITCH OUT", "SWITCH-OUT",
              "SWITCHOUT", "STP OUT", "STP-OUT", "SWP"}

COLUMN_ALIASES = {
    "scheme": ["scheme name", "scheme", "fund name", "fund", "scheme_name"],
    "type": ["transaction type", "type", "txn type", "transaction", "order type"],
    "units": ["units", "quantity", "qty"],
    "nav": ["nav", "price", "nav (rs)", "purchase price"],
    "amount": ["amount", "value", "amount (rs)", "amount (inr)"],
    "date": ["date", "transaction date", "order date", "txn date"],
}

def to_grid(kind, data):
    """Return the file as a list of rows (lists of strings), whatever its format."""
    if kind == "xlsx":
        df = pd.read_excel(io.BytesIO(bytes(data)), header=None, dtype=object)
        df = df.where(pd.notna(df), "")
        rows = []
        for r in df.itertuples(index=False):
            out = []
            for v in r:
                if hasattr(v, "strftime"):
                    out.append(v.strftime("%d %b %Y"))
                else:
                    out.append(str(v))
            rows.append(out)
        return rows
    text = bytes(data).decode("utf-8-sig", errors="replace")
    return list(csv.reader(io.StringIO(text)))

def find_header(grid):
    for i, row in enumerate(grid):
        cells = [c.strip().lower() for c in row]
        if any(c in COLUMN_ALIASES["scheme"] for c in cells) and \\
           any(c in COLUMN_ALIASES["type"] for c in cells):
            mapping = {}
            for key, aliases in COLUMN_ALIASES.items():
                for j, c in enumerate(cells):
                    if c in aliases and key not in mapping:
                        mapping[key] = j
            return i, mapping
    raise ValueError("Couldn't find a header row with 'Scheme Name' and 'Transaction Type'. "
                     "Upload the order-history export from Groww (CSV or XLSX).")

def to_number(v):
    v = str(v).replace(",", "").replace("₹", "").strip()
    try:
        return float(v)
    except ValueError:
        return None

def parse_dates(series):
    s = series.astype(str).str.strip()
    out = pd.to_datetime(s, format="%d %b %Y", errors="coerce")
    for fmt in ("%d-%b-%Y", "%d/%m/%Y", "%d-%m-%Y", "%Y-%m-%d", "%Y-%m-%d %H:%M:%S", "%d %B %Y"):
        missing = out.isna()
        if not missing.any():
            break
        out[missing] = pd.to_datetime(s[missing], format=fmt, errors="coerce")
    return out

def run_engine(kind, data):
    if hasattr(data, "to_bytes"):  # JsProxy of a Uint8Array
        data = data.to_bytes()
    grid = to_grid(kind, data)
    header_idx, cols = find_header(grid)
    required = ["scheme", "type", "units", "date"]
    missing = [k for k in required if k not in cols]
    if missing:
        raise ValueError("Missing required column(s): " + ", ".join(missing))

    records = []
    for row in grid[header_idx + 1:]:
        def cell(key):
            j = cols.get(key)
            return row[j].strip() if j is not None and j < len(row) else ""
        if not cell("scheme") or not cell("type"):
            continue
        records.append({
            "scheme": re.sub(r"\\s+", " ", cell("scheme")),
            "type": cell("type").upper(),
            "units": to_number(cell("units")),
            "nav": to_number(cell("nav")),
            "amount": to_number(cell("amount")),
            "date": cell("date"),
        })
    if not records:
        raise ValueError("The file has a header row but no transactions under it.")

    df = pd.DataFrame(records)
    df["date"] = parse_dates(df["date"])
    skipped = int((df["date"].isna() | df["units"].isna()).sum())
    df = df.dropna(subset=["date", "units"])
    # Derive NAV from amount when the export doesn't carry it
    no_nav = df["nav"].isna() & df["amount"].notna() & (df["units"] > 0)
    df.loc[no_nav, "nav"] = df.loc[no_nav, "amount"] / df.loc[no_nav, "units"]
    df = df.dropna(subset=["nav"])
    df["side"] = df["type"].map(lambda t: "BUY" if t in BUY_TYPES else ("SELL" if t in SELL_TYPES else None))
    ignored_types = sorted(set(df.loc[df["side"].isna(), "type"]))
    df = df[df["side"].notna()]
    # Oldest first; on the same day process purchases before redemptions
    df["side_order"] = (df["side"] == "SELL").astype(int)
    df = df.sort_values(["date", "side_order"], kind="stable")

    matches, holdings, warnings, transactions = [], [], [], []
    funds = {}

    for fund, group in df.groupby("scheme", sort=True):
        asset_class, keyword = classify(fund)
        funds[fund] = {"heuristic": asset_class, "keyword": keyword}
        lots = []  # FIFO queue
        sell_no = 0
        for _, r in group.iterrows():
            units = abs(float(r["units"]))
            nav = float(r["nav"])
            iso = r["date"].strftime("%Y-%m-%d")
            transactions.append({"fund": fund, "side": r["side"], "date": iso,
                                 "units": units, "nav": nav, "amount": units * nav})
            if r["side"] == "BUY":
                lots.append({"units": units, "nav": nav, "date": iso})
                continue
            sell_no += 1
            remaining = units
            while remaining > 1e-6 and lots:
                lot = lots[0]
                take = min(remaining, lot["units"])
                matches.append({
                    "fund": fund, "sellId": f"{fund}#{sell_no}",
                    "sellDate": iso, "buyDate": lot["date"], "units": take,
                    "buyNav": lot["nav"], "sellNav": nav,
                    "cost": take * lot["nav"], "proceeds": take * nav,
                })
                lot["units"] -= take
                remaining -= take
                if lot["units"] <= 1e-6:
                    lots.pop(0)
            # Exports round units to 2-3 decimals, so tiny leftovers are rounding noise
            if remaining > 0.05:
                warnings.append(f"{fund}: {remaining:.3f} units sold on {r['date'].strftime('%d %b %Y')} "
                                "have no matching purchase in this file, so their cost is unknown and they were left out.")
        for lot in lots:
            if lot["units"] > 1e-6:
                holdings.append({"fund": fund, "buyDate": lot["date"],
                                 "units": lot["units"], "buyNav": lot["nav"]})

    if skipped:
        warnings.append(f"{skipped} row(s) had an unreadable date or unit value and were skipped.")
    if ignored_types:
        warnings.append("Ignored transaction types: " + ", ".join(ignored_types))

    return json.dumps({
        "matches": matches, "holdings": holdings, "funds": funds,
        "transactions": transactions, "warnings": warnings,
        "stats": {"rows": int(len(df)),
                  "from": df["date"].min().strftime("%Y-%m-%d"),
                  "to": df["date"].max().strftime("%Y-%m-%d")},
    })
`;

let openpyxlReady = null;

const pyodideReady = (async () => {
  progress("runtime", "Downloading the Python runtime (WebAssembly)…");
  const pyodide = await loadPyodide();
  progress("pandas", "Loading pandas…");
  await pyodide.loadPackage(["pandas", "micropip"]);
  await pyodide.runPythonAsync(PYTHON_ENGINE);
  progress("ready", "Engine ready");
  return pyodide;
})();

pyodideReady.catch((err) => {
  self.postMessage({ type: "boot-error", error: `Couldn't start the Python engine: ${err.message}` });
});

self.onmessage = async (event) => {
  const { type, kind, buffer } = event.data;
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
    progress("parse", "Parsing transactions and matching lots FIFO…");
    const runEngine = pyodide.globals.get("run_engine");
    const json = runEngine(kind, new Uint8Array(buffer));
    runEngine.destroy();
    self.postMessage({ type: "result", data: JSON.parse(json) });
  } catch (error) {
    // Python tracebacks are long; keep the final line (the actual message)
    const msg = String(error.message || error).trim().split("\n").filter(Boolean).pop();
    self.postMessage({ type: "error", error: msg.replace(/^\w+Error: /, "") });
  }
};
