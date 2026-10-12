# GainWise

![CI](https://github.com/anandaahan7-prog/gainwise/actions/workflows/ci.yml/badge.svg)

A private capital-gains tax calculator and planner for Indian mutual fund investors. Upload a Groww order-history
export (CSV or XLSX) or a CAS PDF from CAMS, KFintech or MF Central. Everything is computed inside the browser: a Python
engine (Pyodide + pandas, compiled to WebAssembly) runs in a Web Worker. The transaction file never leaves the device.

## The app: three screens

| Screen | Answers | Contents |
|---|---|---|
| **Tax report** | "What do I owe for this financial year?" | One headline number, a waterfall from gains to tax, notes for the year, losses brought forward from earlier ITRs, and gains by fund that expand into each sale and the purchase lots it used (FIFO) |
| **Portfolio** | "What do I own today?" | Live value and gain per fund, long-term status of every lot, ELSS lock-in, tax type per fund (editable), and **Try selling** to see the tax a sale would cost |
| **Save tax** | "How can I pay less this year?" | Ranked ideas (gain harvesting, loss harvesting, wait-and-save) with inline preview, a **"need cash"** withdrawal optimiser, and upcoming tax dates you can add to your calendar |

Always available: **⬇ Download** (PDF report, lot-wise CSV, Schedule 112A CSV, calendar reminders),
**✦ Ask** (an on-device AI assistant) and the **🔒 Privacy log** (every network request the page made, with what was sent).

## Tax rules

- FIFO lot matching per scheme, in Python.
- Rules for each financial year: pre/post 23 Jul 2024 rates (15%/10% → 20%/12.5%), the ₹1L/₹1.25L equity LTCG exemption,
  Section 50AA (debt bought from 1 Apr 2023 is always taxed at slab), the 2025 redefinition for gold/international funds,
  and indexed debt LTCG for older sales.
- Loss set-off within the year (Sec 70) and losses brought forward from earlier years (Sec 74), then the exemption and
  4% cess.
- Grandfathering (Sec 55(2)(ac)) for equity units bought before 1 Feb 2018, using AMFI's 31 Jan 2018 NAVs.
- ELSS 3-year lock-in: locked units are never suggested for sale.
- Fund classification: name heuristics, then the official AMFI category, then your override.

## Planning tools

- **Gain harvesting** books exactly the unused exemption (re-checked with the full tax engine: ₹0 extra tax).
- **Loss harvesting** suggests a sale only when this year's tax actually drops under ITR set-off rules.
- **Wait and save** flags profitable lots that turn long-term soon.
- **Withdrawal optimiser**: "I need ₹X by a date". It picks which units to redeem across funds for the least tax, with
  a look-ahead greedy search followed by pairwise refinement. Tests compare it with brute force.
- **Calendar export** (`.ics`, RFC 5545): long-term dates, the 31 March deadline, advance-tax instalments and ELSS
  unlocks. Generated in the browser; no account needed.

## Run it

```bash
npm install
npm run server   # NAV cache API on http://localhost:8787 (optional, but recommended)
npm run dev      # app on http://localhost:5173, proxies /api to the server
npm run build    # static site in dist/
```

Without the server the app still works and fetches NAVs straight from mfapi.in, so `dist/` alone can be deployed to a
static host. For a single-process deploy, run `npm run build` and then `npm run server`: the server also serves `dist/`.

## Tests

```bash
npm test                 # JavaScript: tax rules, planner, withdrawal optimiser, calendar, server modules
npm run test:engine      # Python engine (needs pandas==2.2.3, openpyxl, pypdf, pytest)
```

GitHub Actions runs lint, both test suites and the build on every push.

## Test files

Synthetic exports built from real historical NAVs, with no personal data. They're kept outside the repo (in
`Downloads/GainWise test files/`); upload them with **Choose file** or drag them onto the page.

| File | What it shows |
|---|---|
| `0-full-demo-portfolio.csv` | Everything at once: 8 funds, 5 years |
| `1-new-sip-investor.csv` | Purchases only, ELSS lock-in, lots turning long-term soon |
| `2-big-profits-over-limit.csv` | ₹10L+ equity LTCG: exemption exceeded, ~₹1.24L tax |
| `3-two-tax-regimes-fy2024-25.csv` | All four equity heads: 15%/10% before 23 Jul 2024, 20%/12.5% after |
| `4-debt-gold-international.xlsx` | Excel upload: indexed debt LTCG, Sec 50AA slab tax, gold/Nasdaq FoF |
| `5-old-investor-pre-2018.csv` | Grandfathering applied automatically: ₹1,46,362 instead of ₹1,69,534 |
| `6-losses-and-loss-harvesting.csv` | Loss carried forward (FY 2024-25) and loss-harvest ideas |
| `7-messy-export-needs-review.csv` | Other column names, dd/mm/yyyy, SIP/SWP/switches, an unknown fund, bad rows |
| `8-planner-gain-harvesting.csv` | Book ₹1,25,000 of LTCG tax-free, ~₹16,250 future tax avoided |
| `9-planner-loss-harvest-stcg.csv` | Loss harvesting against short-term gains taxed at 20% (~₹9,775) |
| `10-planner-over-limit-loss-harvest.csv` | Loss harvesting after LTCG above the limit (~₹6,187) |
| `11-planner-wait-and-save.csv` | A gold lot turning long-term in weeks; waiting saves ~₹31,281 |
| `12-planner-all-in-one.xlsx` | Excel upload with all three kinds of idea |
| `13-cas-statement-demo.pdf` | Password-protected CAS PDF (password `ABCDE1234F`) |

Planner amounts use today's NAVs, so they shift a little each day (figures checked on 12 Oct 2026).

## NAV cache server (`server/`)

A small HTTP API over **public AMFI data** with zero npm dependencies: Node's built-in `http`, `zlib`, `crypto` and
`sqlite` (Node ≥ 22.13).

- **Data.** Mirrors AMFI's `NAVAll.txt` (about 14K schemes) and scheme master into SQLite, refreshing hourly with a
  conditional GET (`If-None-Match` / `If-Modified-Since`), so an unchanged file costs only a `304`. Loads every scheme's
  NAV on **31 Jan 2018** for grandfathering. Scheme histories come from mfapi.in on demand and are cached.
- **HTTP.**
  - ETag + `304 Not Modified`. The app's price requests use a cacheable `GET /api/navs`, so refreshes revalidate.
  - gzip, a CORS allowlist, and a per-IP token-bucket rate limit (`429` + `Retry-After`).
  - Body-size limits, input validation, a path-traversal guard on static files, and graceful shutdown.
- **Monitoring.** `http://localhost:8787/status` is a live dashboard: requests per minute, p50/p95 latency, 304 and 429
  counts, gzip savings, per-endpoint stats and recent requests (from `GET /api/metrics`).
- **Privacy.** Requests carry only fund names or scheme codes. Bodies and client IPs are never logged or stored.

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/match` | `{"names": [...]}` → best AMFI scheme per broker fund name |
| GET | `/api/navs?codes=` | Latest NAV, category, ISIN (cacheable; revalidates with ETag) |
| POST | `/api/fmv2018` | `{"codes": [...]}` → NAV on 31 Jan 2018 |
| GET | `/api/schemes/search?q=` | Fuzzy scheme search |
| GET | `/api/schemes/:code` | Scheme details |
| GET | `/api/schemes/:code/nav?date=YYYY-MM-DD` | NAV on/before a date (handles holidays) |
| GET | `/api/schemes/:code/history?from=&to=` | NAV history |
| GET | `/api/health`, `/api/metrics`, `/status` | Health, metrics JSON, monitoring page |

Environment variables: `PORT` (8787), `DB_FILE` (`server/data/navs.db`), `ALLOWED_ORIGINS` (localhost dev origins),
`REFRESH_MINUTES` (60), `RATE_LIMIT_PER_MINUTE` (120), `TRUST_PROXY` (0), `STATIC_DIR` (`dist/`).

## Project layout

| Path | What |
|---|---|
| `public/engine.py` | Python engine: CSV/XLSX/CAS PDF parsing, classification heuristics, FIFO matching |
| `public/worker.js` | Pyodide worker that loads the engine (and pypdf for PDFs) |
| `src/lib/tax.js` | Tax treatment per lot, heads, loss set-off, brought-forward losses, exemption, cess |
| `src/lib/portfolio.js` | View model: realized/simulated sales, lots, ELSS lock-in |
| `src/lib/planner.js`, `actions.js` | Gain/loss harvesting, wait-and-save, ranked Save-tax ideas |
| `src/lib/withdraw.js` | Withdrawal optimiser |
| `src/lib/calendar.js` | Tax dates and `.ics` export |
| `src/lib/netlog.js` | Privacy log (Resource Timing + fetch notes) |
| `src/lib/nav.js` | Live NAVs (server first, mfapi.in fallback) |
| `src/components/` | Screens: `TaxReport`, `Portfolio`, `SaveTax`, `Withdraw`, drawers and menus |
| `src/ai/` | WebLLM worker, model loading, prompt context |
| `server/` | NAV cache API (`index.js`, `service.js`, `amfi.js`, `match.js`, `db.js`, `metrics.js`, `status.html`) |
| `tests/` | Vitest suites and `tests/engine` (pytest) |

## Limitations

These are estimates, not tax advice. Not modelled: surcharge, the basic-exemption shortfall adjustment, the 12-month
rule for *listed* non-equity units (e.g. gold ETFs), exit loads and stamp duty. CAS import has been tested on
synthetic statements in the CAMS layout; check results against your CAMS/KFintech capital-gains statement before filing.
