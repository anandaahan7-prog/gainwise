"""CAS PDF import: a password-protected statement laid out like the CAMS/KFintech detailed CAS."""
import io
import json
import runpy
from pathlib import Path

import pytest

pypdf = pytest.importorskip("pypdf")
ENGINE = runpy.run_path(str(Path(__file__).resolve().parents[2] / "public" / "engine.py"))
run_engine = ENGINE["run_engine"]

CAS_LINES = [
    "Consolidated Account Statement",
    "01-Apr-2023 To 30-Sep-2026",
    "Folio No: 1234567/89   PAN: XXXXX0000X   KYC: OK",
    "ICICI Prudential Mutual Fund",
    "P8042-ICICI Prudential Bluechip Fund - Direct Plan - Growth - ISIN: INF109K016L0(Advisor: DIRECT) Registrar : CAMS",
    "Opening Unit Balance: 0.000",
    "05-Jan-2024   Purchase - Via Internet               10,000.00      250.000    40.0000      250.000",
    "05-Jan-2024   *** Stamp Duty ***                          0.50",
    "05-Feb-2024   Systematic Investment Purchase         5,000.00      119.048    42.0000      369.048",
    "10-Mar-2026   Redemption - Via Internet            (12,000.00)    (200.000)    60.0000      169.048",
    "Closing Unit Balance: 169.048   NAV on 30-Sep-2026: INR 62.0000",
    "Folio No: 7654321   PAN: XXXXX0000X",
    "Parag Parikh Mutual Fund",
    "PP001-Parag Parikh Flexi Cap Fund - Direct Plan -",
    "Growth - ISIN: INF879O01027 Registrar : KFINTECH",
    "Opening Unit Balance: 100.000",
    "15-Jun-2025   Switch-In - From Liquid Fund           20,000.00      250.000    80.0000      350.000",
]


def make_pdf(lines):
    """A minimal one-page PDF with the given lines in a monospace font."""
    esc = lambda t: t.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    content = "BT /F1 7 Tf 20 810 Td 10 TL\n" + "".join(f"({esc(l)}) Tj T*\n" for l in lines) + "ET"
    objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        f"<< /Length {len(content.encode('latin-1'))} >>\nstream\n{content}\nendstream",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>",
    ]
    out = io.BytesIO()
    out.write(b"%PDF-1.4\n")
    offsets = []
    for i, body in enumerate(objects, start=1):
        offsets.append(out.tell())
        out.write(f"{i} 0 obj\n{body}\nendobj\n".encode("latin-1"))
    xref = out.tell()
    out.write(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode())
    for off in offsets:
        out.write(f"{off:010d} 00000 n \n".encode())
    out.write(f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
    return out.getvalue()


def encrypted(pdf_bytes, password):
    writer = pypdf.PdfWriter(clone_from=pypdf.PdfReader(io.BytesIO(pdf_bytes)))
    writer.encrypt(user_password=password, owner_password=None, algorithm="AES-128")
    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


@pytest.fixture(scope="module")
def cas_pdf():
    return encrypted(make_pdf(CAS_LINES), "XXXXX0000X")


def test_reads_transactions_from_a_protected_cas(cas_pdf):
    out = json.loads(run_engine("pdf", cas_pdf, "XXXXX0000X"))
    icici = "ICICI Prudential Bluechip Fund - Direct Plan - Growth"
    assert icici in out["funds"] and out["funds"][icici]["isin"] == "INF109K016L0"
    # stamp-duty row skipped; redemption matched FIFO against the January lot
    assert [(m["buyDate"], m["units"], m["buyNav"], m["sellNav"]) for m in out["matches"]] == [("2024-01-05", 200.0, 40.0, 60.0)]
    held = {(h["fund"], h["buyDate"]): round(h["units"], 3) for h in out["holdings"]}
    assert held[(icici, "2024-01-05")] == 50.0 and held[(icici, "2024-02-05")] == 119.048


def test_joins_wrapped_scheme_names_and_flags_opening_balances(cas_pdf):
    out = json.loads(run_engine("pdf", cas_pdf, "XXXXX0000X"))
    parag = next(f for f in out["funds"] if f.startswith("Parag Parikh Flexi Cap Fund"))
    assert out["funds"][parag]["isin"] == "INF879O01027"
    assert any("already held" in w and "Parag Parikh" in w for w in out["warnings"])


def test_password_errors_are_reported(cas_pdf):
    with pytest.raises(ValueError, match="^PASSWORD: This statement is password-protected"):
        run_engine("pdf", cas_pdf, None)
    with pytest.raises(ValueError, match="^PASSWORD: That password didn't open"):
        run_engine("pdf", cas_pdf, "WRONG1234X")


def test_pdf_without_transactions():
    with pytest.raises(ValueError, match="Couldn't find any transactions"):
        run_engine("pdf", make_pdf(["Summary statement", "Total value: 1,00,000.00"]), None)
