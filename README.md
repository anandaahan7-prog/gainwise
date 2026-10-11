# GainWise

A private capital-gains tax calculator for Indian mutual fund investors. Upload a Groww order-history export (CSV or XLSX).
Everything is computed inside the browser: a Python engine (Pyodide + pandas, compiled to WebAssembly) runs in a Web
Worker. The transaction file never leaves the device.

## Features

- **FIFO lot matching in Python/WASM.** Every redemption is matched against the oldest purchase lots, per scheme.
- **Rules for each financial year.** Pre/post 23 Jul 2024 rates (15%/10% → 20%/12.5%), ₹1L/₹1.25L equity LTCG
  exemption, Section 50AA (debt units bought from 1 Apr 2023 always at slab), the 2025 redefinition for gold/international
  funds, indexed debt LTCG for older sales, intra-year loss set-off, loss carry-forward and 4% cess.
- **Grandfathering.** Equity units bought before 1 Feb 2018 use the higher of actual cost and the lower of (31 Jan 2018
  NAV, sale value), and the Schedule 112A export includes the FMV columns.
- **Fund classification.** Name heuristics, then the official AMFI category (when live NAVs are fetched), then manual overrides.
- **Holdings view.** Lot age, long-term date, unrealized P&L. Live NAVs come from [mfapi.in](https://www.mfapi.in/); only
  fund names are sent.
- **Tax planner.**
  - Tax-gain harvesting plan that uses up the remaining exemption.
  - Tax-loss harvesting candidates.
  - "Wait and save" alerts for lots that turn long-term soon.
  - A FIFO what-if sandbox.
- **Export.** Lot-wise capital-gains CSV, Schedule 112A draft CSV, and a printable/PDF report.
- **On-device AI assistant.** [WebLLM](https://github.com/mlc-ai/web-llm) runs Qwen 2.5 or Llama 3.2 on the GPU via WebGPU.
  Model weights download once from Hugging Face. Prompts and portfolio data stay local.

## Run it

```bash
npm install
npm run server   # NAV cache API on http://localhost:8787 (optional, but recommended)
npm run dev      # app on http://localhost:5173 — proxies /api to the server
npm run build    # static site in dist/
```

Without the server the app still works and fetches NAVs straight from mfapi.in, so `dist/` alone can be deployed to
Vercel or Netlify. For a single-process deploy, run `npm run build` and then `npm run server`: the server also serves
`dist/`.

Test files live outside the app, in `Downloads/GainWise test files/`. Upload them with **Choose file** or drag
them onto the page. They're synthetic Groww exports built from real historical NAVs, with no personal data:

| File | What it shows |
|---|---|
| `0-full-demo-portfolio.csv` | Everything at once: 8 funds, 5 years, gain-harvest plan |
| `1-new-sip-investor.csv` | Purchases only: ₹0 tax, holdings, lots turning long-term soon |
| `2-big-profits-over-limit.csv` | ₹10L+ equity LTCG: exemption exceeded, ~₹1.24L tax |
| `3-two-tax-regimes-fy2024-25.csv` | All four equity heads: 15%/10% before 23 Jul 2024, 20%/12.5% after |
| `4-debt-gold-international.xlsx` | Excel upload: indexed debt LTCG, Sec 50AA slab tax, gold/Nasdaq FoF |
| `5-old-investor-pre-2018.csv` | Grandfathering: fetch live NAVs and the tax drops ₹1.70L → ₹1.46L |
| `6-losses-and-loss-harvesting.csv` | Loss carried forward (FY 2024-25) and loss-harvest ideas (fetch NAVs) |
| `7-messy-export-needs-review.csv` | Other column names, dd/mm/yyyy, SIP/SWP/switches, unknown funds, bad rows |

## NAV cache server (`server/`)

The server is a small HTTP API over **public AMFI data**. It has zero npm dependencies: it uses Node's built-in `http`,
`zlib`, `crypto` and `sqlite` (Node ≥ 22.13).

- **Data.** It mirrors AMFI's `NAVAll.txt` (about 14K schemes with category, ISIN and latest NAV) into SQLite. It
  refreshes hourly with a conditional GET (`If-None-Match` / `If-Modified-Since`), so an unchanged file costs only a
  `304`. On first start it loads every scheme's NAV on **31 Jan 2018**, which the app needs for grandfathering. Full
  scheme histories are pulled from mfapi.in on demand and cached.
- **HTTP.**
  - ETag + `304 Not Modified` and `Cache-Control` on GETs, plus gzip compression.
  - A CORS allowlist and a per-IP token-bucket rate limit (`429` + `Retry-After`).
  - Body-size limits and input validation, a path-traversal guard on static files, and graceful shutdown.
- **Privacy.** Requests carry only fund names or scheme codes. Bodies are never logged or stored, and access logs hold
  only method, path, status and latency.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Scheme count, latest NAV date, last refresh |
| POST | `/api/match` | `{"names": [...]}` → best AMFI scheme per broker fund name |
| POST | `/api/navs` | `{"codes": [...]}` → latest NAV, category, ISIN |
| POST | `/api/fmv2018` | `{"codes": [...]}` → NAV on 31 Jan 2018 (Sec 112A grandfathering) |
| GET | `/api/schemes/search?q=` | Fuzzy scheme search |
| GET | `/api/schemes/:code` | Scheme details |
| GET | `/api/schemes/:code/nav?date=YYYY-MM-DD` | NAV on/before a date (handles holidays) |
| GET | `/api/schemes/:code/history?from=&to=` | NAV history |

Environment variables:

| Variable | Default |
|---|---|
| `PORT` | `8787` |
| `DB_FILE` | `server/data/navs.db` |
| `ALLOWED_ORIGINS` | localhost dev origins |
| `REFRESH_MINUTES` | `60` |
| `RATE_LIMIT_PER_MINUTE` | `120` |
| `TRUST_PROXY` | `0` (set to `1` behind a reverse proxy) |
| `STATIC_DIR` | `dist/` |

## Project layout

| Path | What |
|---|---|
| `public/worker.js` | Pyodide worker: file parsing (CSV/XLSX), classification heuristics, FIFO matching |
| `src/lib/tax.js` | Tax treatment per lot, tax heads, loss set-off, exemption, cess |
| `src/lib/portfolio.js` | Builds the view model; JS FIFO for what-if sales |
| `src/lib/planner.js` | Gain/loss harvesting and wait-and-save |
| `src/lib/nav.js` | mfapi.in scheme matching and live NAVs |
| `src/lib/report.js` | CSV exports |
| `src/ai/` | WebLLM worker, model loading, prompt context |
| `src/components/` | UI screens |
| `server/` | NAV cache API: `index.js` (HTTP), `service.js` (refresh/history), `amfi.js` (parsers), `match.js` (name matching), `db.js` (SQLite) |

## Limitations

These are estimates, not tax advice. Not modelled:

- surcharge
- the basic-exemption shortfall adjustment
- the 12-month holding rule for *listed* non-equity units (e.g. gold ETFs)
- exit loads and stamp duty

Cross-check against your CAMS/KFintech capital-gains statement before filing.
