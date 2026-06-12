"""FakturaFlow Phase 2 backend tests: PDF OCR, quotes, rectifications, payments, fiscal projection, accounting books, AI chat."""
import os
import io
import uuid
import pytest
import requests
from reportlab.pdfgen import canvas as rl_canvas

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://flow-billing-4.preview.emergentagent.com").rstrip("/")
API = f"{BASE}/api"

UID = uuid.uuid4().hex[:8]
USER_A = {"email": f"p2_a_{UID}@fakturaflow.es", "password": "TestPass123!", "name": "Phase2 A", "company": "AcmeA"}
USER_B = {"email": f"p2_b_{UID}@fakturaflow.es", "password": "TestPass123!", "name": "Phase2 B"}


def _login_or_register(user):
    s = requests.Session()
    r = s.post(f"{API}/auth/register", json=user, timeout=30)
    if r.status_code == 400:
        r = s.post(f"{API}/auth/login", json={"email": user["email"], "password": user["password"]}, timeout=30)
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def session_a():
    return _login_or_register(USER_A)


@pytest.fixture(scope="module")
def session_b():
    return _login_or_register(USER_B)


@pytest.fixture(scope="module")
def client_id(session_a):
    payload = {"name": "Cliente Phase2", "company": "EmpresaSL", "nif": "B87654321", "email": "p2c@x.es"}
    r = session_a.post(f"{API}/clients", json=payload, timeout=15)
    assert r.status_code == 200
    return r.json()["id"]


# ---------- PDF OCR ----------
def _make_receipt_pdf_bytes() -> bytes:
    buf = io.BytesIO()
    c = rl_canvas.Canvas(buf)
    c.setFont("Helvetica-Bold", 14)
    c.drawString(80, 800, "TICKET MERCADONA")
    c.setFont("Helvetica", 12)
    c.drawString(80, 770, "Fecha: 2026-02-10")
    c.drawString(80, 740, "Producto alimentacion")
    c.drawString(80, 710, "Subtotal: 10.16")
    c.drawString(80, 680, "IVA 21%: 2.14")
    c.drawString(80, 650, "TOTAL: 12.30 EUR")
    c.showPage()
    c.save()
    return buf.getvalue()


def test_ai_ocr_pdf_accepted(session_a):
    pdf_bytes = _make_receipt_pdf_bytes()
    files = {"file": ("ticket.pdf", io.BytesIO(pdf_bytes), "application/pdf")}
    r = session_a.post(f"{API}/ai/ocr-receipt", files=files, timeout=120)
    # Accept either 200 (Groq parsed) or 500 (Groq could not parse synthetic PDF) per problem statement.
    assert r.status_code in (200, 500), f"unexpected status {r.status_code}: {r.text}"
    if r.status_code == 200:
        d = r.json()
        for k in ["amount", "iva", "merchant", "date", "category", "description"]:
            assert k in d, f"missing key {k} in {d}"


def test_ai_ocr_invalid_format_rejected(session_a):
    files = {"file": ("data.txt", io.BytesIO(b"hello"), "text/plain")}
    r = session_a.post(f"{API}/ai/ocr-receipt", files=files, timeout=30)
    assert r.status_code == 400


# ---------- QUOTES ----------
@pytest.fixture(scope="module")
def quote_id(session_a, client_id):
    payload = {
        "client_id": client_id, "issue_date": "2026-02-15", "valid_until": "2026-03-15",
        "items": [{"description": "Consultoría", "quantity": 5, "price": 80, "iva": 21, "irpf": 0, "discount": 0}],
        "status": "pendiente",
    }
    r = session_a.post(f"{API}/quotes", json=payload, timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["number"].startswith("P-")
    assert abs(d["subtotal"] - 400) < 0.01
    assert abs(d["iva_total"] - 84) < 0.01
    assert abs(d["total"] - 484) < 0.01
    return d["id"]


def test_quotes_list(session_a, quote_id):
    r = session_a.get(f"{API}/quotes", timeout=15)
    assert r.status_code == 200
    assert any(q["id"] == quote_id for q in r.json())


def test_quote_get(session_a, quote_id):
    r = session_a.get(f"{API}/quotes/{quote_id}", timeout=15)
    assert r.status_code == 200


def test_quote_update(session_a, quote_id, client_id):
    payload = {
        "client_id": client_id, "issue_date": "2026-02-15", "valid_until": "2026-03-31",
        "items": [{"description": "Consultoría", "quantity": 5, "price": 80, "iva": 21, "irpf": 0, "discount": 0}],
        "status": "pendiente",
    }
    r = session_a.put(f"{API}/quotes/{quote_id}", json=payload, timeout=15)
    assert r.status_code == 200


def test_quote_pdf(session_a, quote_id):
    r = session_a.get(f"{API}/quotes/{quote_id}/pdf", timeout=30)
    assert r.status_code == 200
    assert r.headers.get("content-type", "").startswith("application/pdf")
    assert r.content[:4] == b"%PDF"


def test_quote_convert_creates_invoice(session_a, quote_id):
    r = session_a.post(f"{API}/quotes/{quote_id}/convert", timeout=20)
    assert r.status_code == 200, r.text
    inv = r.json()
    assert inv["number"].startswith("A-")
    assert inv["type"] == "factura"
    # Quote should now be marked aceptado with converted_invoice_id
    q = session_a.get(f"{API}/quotes/{quote_id}", timeout=15).json()
    assert q["status"] == "aceptado"
    assert q["converted_invoice_id"] == inv["id"]
    # Save invoice id for cleanup
    pytest.converted_invoice_id = inv["id"]


def test_quote_double_convert_rejected(session_a, quote_id):
    r = session_a.post(f"{API}/quotes/{quote_id}/convert", timeout=15)
    assert r.status_code == 400


# ---------- RECTIFICATIVAS ----------
@pytest.fixture(scope="module")
def base_invoice_id(session_a, client_id):
    payload = {
        "client_id": client_id, "series": "A", "issue_date": "2026-02-10", "due_date": "2026-03-10",
        "items": [{"description": "Servicio", "quantity": 1, "price": 100, "iva": 21, "irpf": 0, "discount": 0}],
        "status": "pendiente",
    }
    r = session_a.post(f"{API}/invoices", json=payload, timeout=15)
    assert r.status_code == 200
    return r.json()["id"]


def test_rectify_creates_negative_invoice(session_a, base_invoice_id):
    r = session_a.post(f"{API}/invoices/{base_invoice_id}/rectify", timeout=15)
    assert r.status_code == 200, r.text
    rect = r.json()
    assert rect["type"] == "rectificativa"
    assert rect["series"] == "R"
    assert rect["number"].startswith("R-")
    assert rect["rectifies_id"] == base_invoice_id
    assert rect["rectifies_number"]
    assert rect["items"][0]["quantity"] == -1
    assert rect["subtotal"] < 0
    assert rect["total"] < 0


# ---------- PAYMENTS ----------
@pytest.fixture(scope="module")
def pay_invoice_id(session_a, client_id):
    payload = {
        "client_id": client_id, "series": "A", "issue_date": "2026-02-12", "due_date": "2099-12-31",
        "items": [{"description": "Trabajo", "quantity": 1, "price": 100, "iva": 0, "irpf": 0, "discount": 0}],
        "status": "pendiente",
    }
    r = session_a.post(f"{API}/invoices", json=payload, timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert abs(d["total"] - 100) < 0.01
    return d["id"]


def test_payment_partial_then_full(session_a, pay_invoice_id):
    # Partial 60
    r1 = session_a.post(f"{API}/invoices/{pay_invoice_id}/payments",
                        json={"amount": 60, "date": "2026-02-13", "method": "transferencia"}, timeout=15)
    assert r1.status_code == 200, r1.text
    p1 = r1.json()
    inv = session_a.get(f"{API}/invoices/{pay_invoice_id}", timeout=15).json()
    assert abs(inv["paid_amount"] - 60) < 0.01
    assert inv["status"] == "pendiente"
    # Final 40 -> pagada
    r2 = session_a.post(f"{API}/invoices/{pay_invoice_id}/payments",
                        json={"amount": 40, "date": "2026-02-14", "method": "transferencia"}, timeout=15)
    assert r2.status_code == 200
    inv2 = session_a.get(f"{API}/invoices/{pay_invoice_id}", timeout=15).json()
    assert abs(inv2["paid_amount"] - 100) < 0.01
    assert inv2["status"] == "pagada"
    # GET payments -> 2 entries
    r3 = session_a.get(f"{API}/invoices/{pay_invoice_id}/payments", timeout=15)
    assert r3.status_code == 200
    assert len(r3.json()) == 2
    # Delete first payment -> back to pendiente, paid_amount 40
    rd = session_a.delete(f"{API}/payments/{p1['id']}", timeout=15)
    assert rd.status_code == 200
    inv3 = session_a.get(f"{API}/invoices/{pay_invoice_id}", timeout=15).json()
    assert abs(inv3["paid_amount"] - 40) < 0.01
    assert inv3["status"] == "pendiente"


# ---------- MOROSOS ----------
def test_clients_morosos(session_a, client_id):
    # pay_invoice has paid 40/100 with due_date 2026-03-12 - might or might not be overdue depending on today
    # Create overdue invoice for sure
    payload = {
        "client_id": client_id, "series": "A", "issue_date": "2024-01-01", "due_date": "2024-02-01",
        "items": [{"description": "Antiguo", "quantity": 1, "price": 50, "iva": 0, "irpf": 0, "discount": 0}],
        "status": "pendiente",
    }
    r = session_a.post(f"{API}/invoices", json=payload, timeout=15)
    assert r.status_code == 200
    overdue_id = r.json()["id"]
    rm = session_a.get(f"{API}/clients/morosos", timeout=15)
    assert rm.status_code == 200
    found = [m for m in rm.json() if m["client_id"] == client_id]
    assert found, "Expected client to appear in morosos"
    assert found[0]["total_owed"] >= 50
    # cleanup
    session_a.delete(f"{API}/invoices/{overdue_id}", timeout=15)


# ---------- FISCAL PROJECTION ----------
def test_fiscal_projection_shape(session_a):
    r = session_a.get(f"{API}/fiscal/projection", timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    for top in ["today", "year", "quarter", "current", "current_quarter_taxes", "yearly_projection"]:
        assert top in d, f"missing top key {top}"
    for k in ["income_month", "income_quarter", "income_year",
              "expenses_month", "expenses_quarter", "expenses_year",
              "benefit_month", "benefit_quarter", "benefit_year"]:
        assert k in d["current"], f"missing current.{k}"
    for k in ["iva_rep", "iva_sop", "iva_a_pagar_303", "irpf_retenido", "irpf_130_estimado"]:
        assert k in d["current_quarter_taxes"], f"missing current_quarter_taxes.{k}"
    for k in ["income", "expenses", "benefit", "irpf_estimated", "iva_estimated", "tax_total_estimated"]:
        assert k in d["yearly_projection"], f"missing yearly_projection.{k}"


# ---------- ACCOUNTING BOOKS ----------
def test_accounting_books_year(session_a):
    r = session_a.get(f"{API}/accounting/books", params={"year": 2026}, timeout=15)
    assert r.status_code == 200
    d = r.json()
    for k in ["libro_ingresos", "libro_gastos", "iva_rep_lines", "iva_sop_lines", "totals"]:
        assert k in d
    assert isinstance(d["libro_ingresos"], list)
    assert isinstance(d["libro_gastos"], list)
    for tk in ["ingresos_base", "ingresos_iva", "gastos_base", "gastos_iva", "iva_rep", "iva_sop", "iva_a_liquidar", "beneficio"]:
        assert tk in d["totals"]


def test_accounting_books_quarter(session_a):
    r = session_a.get(f"{API}/accounting/books", params={"year": 2026, "quarter": 1}, timeout=15)
    assert r.status_code == 200
    d = r.json()
    assert d["quarter"] == 1


# ---------- AI CHAT ----------
def test_ai_chat_session_persistence(session_a):
    r1 = session_a.post(f"{API}/ai/chat", json={"message": "¿Cuánto he facturado este año?"}, timeout=90)
    assert r1.status_code == 200, r1.text
    d1 = r1.json()
    assert "answer" in d1 and "session_id" in d1
    assert isinstance(d1["answer"], str) and len(d1["answer"]) > 0
    sid = d1["session_id"]
    # Second message in same session
    r2 = session_a.post(f"{API}/ai/chat", json={"message": "¿Y mis gastos?", "session_id": sid}, timeout=90)
    assert r2.status_code == 200
    assert r2.json()["session_id"] == sid
    # History should have 4 messages (2 user, 2 assistant)
    h = session_a.get(f"{API}/ai/chat/history", params={"session_id": sid}, timeout=15)
    assert h.status_code == 200
    msgs = h.json()
    assert len(msgs) >= 4
    roles = [m["role"] for m in msgs]
    assert roles.count("user") >= 2 and roles.count("assistant") >= 2


# ---------- USER SCOPING ----------
def test_user_b_cannot_access_a_quote(session_b, quote_id):
    r = session_b.get(f"{API}/quotes/{quote_id}", timeout=15)
    assert r.status_code == 404


def test_user_b_cannot_access_a_invoice(session_b, base_invoice_id):
    r = session_b.get(f"{API}/invoices/{base_invoice_id}", timeout=15)
    assert r.status_code == 404


def test_user_b_cannot_access_a_payments(session_b, pay_invoice_id):
    # Listing payments under B's session for A's invoice should return [] (since user_id is filtered)
    r = session_b.get(f"{API}/invoices/{pay_invoice_id}/payments", timeout=15)
    assert r.status_code == 200
    assert r.json() == []


def test_user_b_cannot_see_a_chat_history(session_a, session_b):
    # Create a chat in A
    r1 = session_a.post(f"{API}/ai/chat", json={"message": "Test scoping"}, timeout=90)
    assert r1.status_code == 200
    sid = r1.json()["session_id"]
    # B fetching same session_id should return empty list
    h = session_b.get(f"{API}/ai/chat/history", params={"session_id": sid}, timeout=15)
    assert h.status_code == 200
    assert h.json() == []


# ---------- EXISTING ENDPOINTS still work ----------
def test_dashboard_still_works(session_a):
    r = session_a.get(f"{API}/dashboard", timeout=15)
    assert r.status_code == 200


def test_invoices_list_with_type_filter(session_a):
    r = session_a.get(f"{API}/invoices", params={"type": "rectificativa"}, timeout=15)
    assert r.status_code == 200
    types = [i.get("type") for i in r.json()]
    if types:
        assert all(t == "rectificativa" for t in types)


# ---------- CLEANUP ----------
def test_zz_cleanup(session_a, client_id, base_invoice_id, pay_invoice_id, quote_id):
    # Delete created invoices/quotes/clients (best-effort)
    session_a.delete(f"{API}/invoices/{base_invoice_id}", timeout=15)
    session_a.delete(f"{API}/invoices/{pay_invoice_id}", timeout=15)
    if hasattr(pytest, "converted_invoice_id"):
        session_a.delete(f"{API}/invoices/{pytest.converted_invoice_id}", timeout=15)
    session_a.delete(f"{API}/quotes/{quote_id}", timeout=15)
    session_a.delete(f"{API}/clients/{client_id}", timeout=15)
