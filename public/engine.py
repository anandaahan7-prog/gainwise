# GainWise tax engine: parses a broker export and matches every redemption FIFO.
# Runs in the browser via Pyodide (public/worker.js) and under CPython in the test suite.
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
        if any(c in COLUMN_ALIASES["scheme"] for c in cells) and \
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

# ---------------------------------------------------------------------------
# CAS PDF (CAMS / KFintech / MF Central detailed statement)
# ---------------------------------------------------------------------------
NUM = r"\(?-?[\d,]+\.\d+\)?"
CAS_TXN = re.compile(
    r"^\s*(\d{2}-[A-Za-z]{3}-\d{4})\s+(.+?)\s+(" + NUM + r")\s+(" + NUM + r")\s+(" + NUM + r")\s+(" + NUM + r")\s*$"
)
CAS_ISIN = re.compile(r"ISIN\s*:?\s*(IN[FE][A-Z0-9]{9})", re.I)
CAS_OPENING = re.compile(r"Opening\s+Unit\s+Balance\s*:?\s*(" + NUM + r")", re.I)
RTA_CODE = re.compile(r"^[A-Z0-9]{2,12}-\s*")


def cas_number(text):
    t = text.replace(",", "").strip()
    negative = t.startswith("(") or t.startswith("-")
    value = float(t.strip("()-"))
    return -value if negative else value


def cas_side(description, units):
    d = description.lower()
    if any(k in d for k in ("stamp duty", "stt", "tds", "***")):
        return None
    if any(k in d for k in ("redemption", "redeem", "switch out", "switch-out", "switchout", "swp",
                            "systematic withdrawal", "transfer out", "stp out")):
        return "SELL"
    if any(k in d for k in ("purchase", "sip", "systematic investment", "switch in", "switch-in", "switchin",
                            "reinvest", "transfer in", "stp in", "allotment")):
        return "BUY"
    return "SELL" if units < 0 else "BUY"


def clean_scheme_name(text):
    name = RTA_CODE.sub("", text.strip())
    name = re.sub(r"\(\s*(advisor|formerly|erstwhile|non-demat|demat)[^)]*\)", " ", name, flags=re.I)
    name = re.sub(r"Registrar\s*:.*$", "", name, flags=re.I)
    return re.sub(r"\s+", " ", name).strip(" -")


def records_from_cas(data, password):
    """Read a password-protected CAS PDF into the same records the CSV path produces."""
    # Errors are raised outside `except` blocks on purpose: chained exceptions break
    # Pyodide's traceback formatting, and the UI relies on the "PASSWORD:" message prefix.
    reader_cls = None
    try:
        from pypdf import PdfReader as reader_cls
    except ImportError:
        pass
    if reader_cls is None:
        raise ValueError("The PDF reader isn't available.")
    reader = reader_cls(io.BytesIO(bytes(data)))
    if reader.is_encrypted:
        if not password:
            raise ValueError("PASSWORD: This statement is password-protected. CAS passwords are usually your PAN in capital letters.")
        opened = False
        try:
            opened = bool(reader.decrypt(password))
        except Exception:
            opened = False
        if not opened:
            raise ValueError("PASSWORD: That password didn't open the PDF. CAS passwords are usually your PAN in capital letters.")

    lines = []
    for page in reader.pages:
        try:
            text = page.extract_text(extraction_mode="layout")
        except TypeError:  # older pypdf
            text = page.extract_text()
        lines.extend((text or "").splitlines())

    records, isins, warnings = [], {}, []
    scheme = None
    previous = ""
    for raw_line in lines:
        line = raw_line.rstrip()
        if not line.strip():
            continue
        isin = CAS_ISIN.search(line)
        if isin and not CAS_TXN.match(line):
            before = line[: isin.start()].strip().rstrip("-").strip()
            # Long scheme names wrap onto two lines; the first line has the RTA code prefix
            if previous and not RTA_CODE.match(before) and RTA_CODE.match(previous.strip()):
                before = previous.strip().rstrip("-") + " " + before
            scheme = clean_scheme_name(before)
            isins[scheme] = isin.group(1).upper()
            previous = ""
            continue
        opening = CAS_OPENING.search(line)
        if opening and scheme and cas_number(opening.group(1)) > 0.001:
            warnings.append(f"{scheme}: the statement starts with {cas_number(opening.group(1)):.3f} units already held. "
                            "Download a CAS covering your full history so their cost is known.")
        m = CAS_TXN.match(line)
        if m and scheme:
            date, description, amount, units, price, _balance = m.groups()
            u = cas_number(units)
            side = cas_side(description, u)
            if side:
                records.append({
                    "scheme": scheme,
                    "type": "PURCHASE" if side == "BUY" else "REDEEM",
                    "units": abs(u),
                    "nav": abs(cas_number(price)),
                    "amount": abs(cas_number(amount)),
                    "date": date,
                })
            previous = ""
            continue
        previous = line
    if not records:
        raise ValueError("Couldn't find any transactions in this PDF. GainWise reads the detailed CAS from "
                         "CAMS, KFintech or MF Central (not the summary version).")
    return records, isins, warnings


def records_from_grid(grid):
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
            "scheme": re.sub(r"\s+", " ", cell("scheme")),
            "type": cell("type").upper(),
            "units": to_number(cell("units")),
            "nav": to_number(cell("nav")),
            "amount": to_number(cell("amount")),
            "date": cell("date"),
        })
    if not records:
        raise ValueError("The file has a header row but no transactions under it.")
    return records


def run_engine(kind, data, password=None):
    if hasattr(data, "to_bytes"):  # JsProxy of a Uint8Array
        data = data.to_bytes()
    if kind == "pdf":
        records, isins, notes = records_from_cas(data, password)
    else:
        records, isins, notes = records_from_grid(to_grid(kind, data)), {}, []
    return process_records(records, isins, notes)


def process_records(records, isins=None, notes=None):
    isins = isins or {}
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
        funds[fund] = {"heuristic": asset_class, "keyword": keyword, "isin": isins.get(fund)}
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

    warnings.extend(notes or [])
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


def run_engine_safe(kind, data, password=None):
    """Entry point for the browser: errors come back as JSON instead of crossing into JS as
    Python exceptions (Pyodide can fail while converting some tracebacks)."""
    try:
        return run_engine(kind, data, password)
    except Exception as e:
        return json.dumps({"error": str(e) or e.__class__.__name__})
