"""Tests for the Python tax engine (public/engine.py), the same file Pyodide runs in the browser."""
import io
import json
import runpy
from pathlib import Path

import pytest

ENGINE = runpy.run_path(str(Path(__file__).resolve().parents[2] / "public" / "engine.py"))
run_engine = ENGINE["run_engine"]
classify = ENGINE["classify"]

PREAMBLE = """Unnamed: 0,Unnamed: 1,Unnamed: 2,Unnamed: 3,Unnamed: 4,Unnamed: 5
,,,,,
Personal Details,,,,,
Name,Test Investor,,,,
PAN,XXXXX0000X,,,,
,,,,,
Scheme Name,Transaction Type,Units,NAV,Amount,Date
,,,,,
"""


def run_csv(text):
    return json.loads(run_engine("csv", text.encode("utf-8")))


def test_fifo_matches_oldest_lots_first():
    out = run_csv(PREAMBLE + """Alpha Flexi Cap Fund Direct Growth,REDEEM,150,30,"4,500",10 Jan 2026
Alpha Flexi Cap Fund Direct Growth,PURCHASE,100,20,"2,000",05 Feb 2024
Alpha Flexi Cap Fund Direct Growth,PURCHASE,100,10,"1,000",05 Jan 2024
""")
    m = out["matches"]
    assert [(x["buyDate"], x["units"], x["buyNav"]) for x in m] == [("2024-01-05", 100, 10), ("2024-02-05", 50, 20)]
    assert all(x["sellDate"] == "2026-01-10" and x["sellNav"] == 30 for x in m)
    assert out["holdings"] == [{"fund": "Alpha Flexi Cap Fund Direct Growth", "buyDate": "2024-02-05", "units": 50.0, "buyNav": 20.0}]
    assert out["funds"]["Alpha Flexi Cap Fund Direct Growth"]["heuristic"] == "Equity"
    assert "Test Investor" not in json.dumps(out)  # personal rows are skipped


def test_same_day_purchase_is_matched_before_redemption():
    out = run_csv(PREAMBLE + """Beta Liquid Fund Direct Growth,REDEEM,10,101,"1,010",01 Mar 2025
Beta Liquid Fund Direct Growth,PURCHASE,10,100,"1,000",01 Mar 2025
""")
    assert len(out["matches"]) == 1 and out["warnings"] == []


def test_unmatched_sales_warn_but_rounding_dust_is_ignored():
    out = run_csv(PREAMBLE + """Gamma Midcap Fund Direct Growth,PURCHASE,10,100,"1,000",01 Jan 2024
Gamma Midcap Fund Direct Growth,REDEEM,10.01,120,"1,201",01 Feb 2025
Delta Small Cap Fund Direct Growth,REDEEM,5,50,250,01 Feb 2025
""")
    warnings = " ".join(out["warnings"])
    assert "Delta Small Cap" in warnings and "Gamma" not in warnings


def test_messy_export_columns_dates_and_types():
    out = run_csv("""Fund Name,Type,Quantity,Price,Value,Transaction Date
Epsilon Balanced Advantage Fund Direct Growth,SIP,10,100,1000,05/06/2024
Epsilon Balanced Advantage Fund Direct Growth,SWITCH IN,10,110,1100,05/07/2024
Epsilon Balanced Advantage Fund Direct Growth,SWP,5,120,600,05/08/2025
Epsilon Balanced Advantage Fund Direct Growth,DIVIDEND PAYOUT,0,0,50,05/09/2025
Epsilon Balanced Advantage Fund Direct Growth,SIP,abc,100,1000,not a date
""")
    assert len(out["matches"]) == 1 and out["matches"][0]["buyDate"] == "2024-06-05"
    assert out["stats"]["rows"] == 3
    joined = " ".join(out["warnings"])
    assert "1 row(s)" in joined and "DIVIDEND PAYOUT" in joined


def test_xlsx_upload(tmp_path):
    openpyxl = pytest.importorskip("openpyxl")
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["Personal Details"])
    ws.append(["Scheme Name", "Transaction Type", "Units", "NAV", "Amount", "Date"])
    ws.append(["Zeta Gold Fund Direct Growth", "PURCHASE", 100, 20, "2,000", "04 Nov 2024"])
    ws.append(["Zeta Gold Fund Direct Growth", "REDEEM", 40, 30, "1,200", "15 Sep 2025"])
    buf = io.BytesIO()
    wb.save(buf)
    out = json.loads(run_engine("xlsx", buf.getvalue()))
    assert out["matches"][0]["units"] == 40 and out["holdings"][0]["units"] == 60
    assert out["funds"]["Zeta Gold Fund Direct Growth"]["heuristic"] == "Other"


@pytest.mark.parametrize("name,expected", [
    ("Mirae Asset Great Consumer Fund Direct Growth", "Equity"),
    ("Tata Arbitrage Fund Direct Growth", "Equity"),
    ("ICICI Prudential Large Cap Fund Direct Growth", "Equity"),
    ("Edelweiss Nifty SDL Index Fund Direct Growth", "Debt"),
    ("HDFC Corporate Bond Fund Direct Growth", "Debt"),
    ("SBI Gold Fund Direct Growth", "Other"),
    ("SBI Childrens Fund Savings Plan Direct Growth", "Unknown"),
])
def test_classification_heuristics(name, expected):
    assert classify(name)[0] == expected


def test_missing_header_is_a_clear_error():
    with pytest.raises(ValueError, match="Scheme Name"):
        run_csv("Name,Value\nfoo,1\n")
