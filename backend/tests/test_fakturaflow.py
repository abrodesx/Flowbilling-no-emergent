"""FakturaFlow comprehensive backend tests."""
import os, io, uuid, base64, time
import pytest, requests
from PIL import Image, ImageDraw

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://flow-billing-4.preview.emergentagent.com").rstrip("/")
API = f"{BASE}/api"

UID = uuid.uuid4().hex[:8]
USER_A = {"email": f"test_a_{UID}@fakturaflow.es", "password": "TestPass123!", "name": "User A", "company": "AcmeA"}
USER_B = {"email": f"test_b_{UID}@fakturaflow.es", "password": "TestPass123!", "name": "User B"}


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


# ---------- AUTH ----------
def test_register_duplicate(session_a):
    r = requests.post(f"{API}/auth/register", json=USER_A, timeout=15)
    assert r.status_code == 400


def test_login_wrong():
    r = requests.post(f"{API}/auth/login", json={"email": USER_A["email"], "password": "wrong"}, timeout=15)
    assert r.status_code == 401


def test_login_ok():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": USER_A["email"], "password": USER_A["password"]}, timeout=15)
    assert r.status_code == 200
    assert r.json()["email"] == USER_A["email"]
    assert "access_token" in s.cookies


def test_me_requires_auth():
    r = requests.get(f"{API}/auth/me", timeout=15)
    assert r.status_code == 401


def test_me_ok(session_a):
    r = session_a.get(f"{API}/auth/me", timeout=15)
    assert r.status_code == 200
    assert r.json()["email"] == USER_A["email"]


def test_logout(session_a):
    s = requests.Session()
    s.post(f"{API}/auth/login", json={"email": USER_A["email"], "password": USER_A["password"]}, timeout=15)
    r = s.post(f"{API}/auth/logout", timeout=15)
    assert r.status_code == 200


# ---------- CLIENTS ----------
@pytest.fixture(scope="module")
def client_id(session_a):
    payload = {"name": "Cliente Test", "company": "Empresa SL", "nif": "B12345678", "email": "c@x.es"}
    r = session_a.post(f"{API}/clients", json=payload, timeout=15)
    assert r.status_code == 200
    return r.json()["id"]


def test_clients_list(session_a, client_id):
    r = session_a.get(f"{API}/clients", timeout=15)
    assert r.status_code == 200
    assert any(c["id"] == client_id for c in r.json())


def test_client_update(session_a, client_id):
    r = session_a.put(f"{API}/clients/{client_id}", json={"name": "Cliente Actualizado", "nif": "B12345678"}, timeout=15)
    assert r.status_code == 200
    r2 = session_a.get(f"{API}/clients", timeout=15)
    assert any(c["id"] == client_id and c["name"] == "Cliente Actualizado" for c in r2.json())


# ---------- INVOICES ----------
@pytest.fixture(scope="module")
def invoice_id(session_a, client_id):
    payload = {
        "client_id": client_id, "series": "A", "issue_date": "2025-03-15", "due_date": "2025-04-15",
        "items": [{"description": "Servicio", "quantity": 2, "price": 100, "iva": 21, "irpf": 15, "discount": 0}],
        "status": "pagada",
    }
    r = session_a.post(f"{API}/invoices", json=payload, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    # verify totals: line=200, iva=42, irpf=30, total=212
    assert abs(data["subtotal"] - 200) < 0.01
    assert abs(data["iva_total"] - 42) < 0.01
    assert abs(data["irpf_total"] - 30) < 0.01
    assert abs(data["total"] - 212) < 0.01
    assert data["number"].startswith("A-")
    return data["id"]


def test_invoice_get(session_a, invoice_id):
    r = session_a.get(f"{API}/invoices/{invoice_id}", timeout=15)
    assert r.status_code == 200


def test_invoice_duplicate(session_a, invoice_id):
    r = session_a.post(f"{API}/invoices/{invoice_id}/duplicate", timeout=15)
    assert r.status_code == 200
    assert r.json()["status"] == "pendiente"


def test_invoice_pdf(session_a, invoice_id):
    r = session_a.get(f"{API}/invoices/{invoice_id}/pdf", timeout=30)
    assert r.status_code == 200
    assert r.headers.get("content-type", "").startswith("application/pdf")
    assert r.content[:4] == b"%PDF"


# ---------- EXPENSES ----------
@pytest.fixture(scope="module")
def expense_id(session_a):
    r = session_a.post(f"{API}/expenses", json={"description": "Compra material", "category": "Material oficina", "amount": 121, "iva": 21, "date": "2025-03-10", "supplier": "Prov SL"}, timeout=15)
    assert r.status_code == 200
    return r.json()["id"]


def test_expenses_list(session_a, expense_id):
    r = session_a.get(f"{API}/expenses", timeout=15)
    assert r.status_code == 200
    assert any(e["id"] == expense_id for e in r.json())


def test_expense_update(session_a, expense_id):
    r = session_a.put(f"{API}/expenses/{expense_id}", json={"description": "Mod", "category": "Otros", "amount": 50, "iva": 21, "date": "2025-03-10"}, timeout=15)
    assert r.status_code == 200


# ---------- DASHBOARD ----------
def test_dashboard(session_a):
    r = session_a.get(f"{API}/dashboard", timeout=15)
    assert r.status_code == 200
    d = r.json()
    for k in ["income_paid", "expenses", "benefit", "iva_balance", "monthly", "recent", "pending_count", "paid_count"]:
        assert k in d


# ---------- REPORTS ----------
def test_quarter_report(session_a):
    r = session_a.get(f"{API}/reports/quarter/2025/1", timeout=15)
    assert r.status_code == 200
    d = r.json()
    assert d["quarter"] == 1
    assert "iva_pay" in d


def test_year_report(session_a):
    r = session_a.get(f"{API}/reports/year/2025", timeout=15)
    assert r.status_code == 200
    assert "top_clients" in r.json()


def test_quarter_invalid(session_a):
    r = session_a.get(f"{API}/reports/quarter/2025/9", timeout=15)
    assert r.status_code == 400


# ---------- FISCAL CALENDAR ----------
def test_fiscal_calendar(session_a):
    r = session_a.get(f"{API}/fiscal-calendar/2025", timeout=15)
    assert r.status_code == 200
    items = r.json()
    models = {i["model"] for i in items}
    assert "Modelo 303" in models and "Modelo 130" in models and "Modelo 111" in models and "Modelo 390" in models


# ---------- SETTINGS (legacy GET only; updates now go through PUT /profiles/{id}) ----------
def test_settings_get_put(session_a):
    r = session_a.get(f"{API}/settings", timeout=15)
    assert r.status_code == 200
    # Phase 3: PUT /settings has been removed. Update active profile instead.
    profs = session_a.get(f"{API}/profiles", timeout=15).json()
    default = next((p for p in profs if p.get("is_default")), profs[0])
    payload = {"name": default.get("name", "Personal"), "type": default.get("type", "autonomo"),
               "fiscal_name": "Mi Empresa", "nif": "12345678Z",
               "default_iva": 21, "default_irpf": 15, "invoice_series": ["A", "B"], "primary_color": "#2563EB"}
    r2 = session_a.put(f"{API}/profiles/{default['id']}", json=payload, timeout=15)
    assert r2.status_code == 200
    r3 = session_a.get(f"{API}/settings", timeout=15)
    assert r3.json()["fiscal_name"] == "Mi Empresa"


# ---------- SEARCH ----------
def test_search(session_a):
    r = session_a.get(f"{API}/search", params={"q": "Cliente"}, timeout=15)
    assert r.status_code == 200
    d = r.json()
    assert "clients" in d and "invoices" in d and "expenses" in d


# ---------- AUTH SCOPING ----------
def test_user_scoping(session_b, client_id, invoice_id):
    r = session_b.get(f"{API}/clients", timeout=15)
    assert r.status_code == 200
    assert all(c["id"] != client_id for c in r.json())
    r2 = session_b.get(f"{API}/invoices/{invoice_id}", timeout=15)
    assert r2.status_code == 404


# ---------- AI ----------
def test_ai_generate_concept(session_a):
    r = session_a.post(f"{API}/ai/generate-concept", json={"prompt": "Diseño web para tienda online"}, timeout=60)
    assert r.status_code == 200, r.text
    assert len(r.json().get("text", "")) > 0


def test_ai_financial_summary(session_a):
    r = session_a.post(f"{API}/ai/financial-summary", timeout=60)
    assert r.status_code == 200, r.text
    d = r.json()
    assert "summary" in d
    assert isinstance(d["summary"], str) and len(d["summary"]) > 0


def _make_receipt_jpeg():
    img = Image.new("RGB", (400, 300), "white")
    d = ImageDraw.Draw(img)
    d.text((20, 20), "TICKET TIENDA SL", fill="black")
    d.text((20, 60), "Fecha: 2025-03-12", fill="black")
    d.text((20, 100), "Material oficina", fill="black")
    d.text((20, 140), "Subtotal: 10.00", fill="black")
    d.text((20, 170), "IVA 21%: 2.10", fill="black")
    d.text((20, 200), "TOTAL: 12.10 EUR", fill="black")
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    buf.seek(0)
    return buf


def test_ai_ocr_receipt(session_a):
    img = _make_receipt_jpeg()
    files = {"file": ("receipt.jpg", img, "image/jpeg")}
    r = session_a.post(f"{API}/ai/ocr-receipt", files=files, timeout=90)
    assert r.status_code == 200, r.text
    d = r.json()
    # should have at least these keys (values may be null)
    for k in ["amount", "iva", "merchant", "date", "category", "description"]:
        assert k in d


# ---------- CLEANUP ----------
def test_zz_delete(session_a, client_id, invoice_id, expense_id):
    assert session_a.delete(f"{API}/invoices/{invoice_id}", timeout=15).status_code == 200
    assert session_a.delete(f"{API}/expenses/{expense_id}", timeout=15).status_code == 200
    assert session_a.delete(f"{API}/clients/{client_id}", timeout=15).status_code == 200
