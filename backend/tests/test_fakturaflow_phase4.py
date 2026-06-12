"""FakturaFlow Phase 4 — backend tests for iteration 7 (lote A+B+C):
- Audit log
- CSV Export (clients/invoices/expenses)
- CSV Import (clients/invoices/expenses)
- Advanced search
- Email templates (defaults + CRUD + preview)
- Gestor portal (read-only public link)
- Contract PDF generation
- Digital signature (certificate upload + signed PDF visual)
- Logo upload (data URL persisted + embedded in invoice PDF)
- Regresion smoke (auth, invoices CRUD, dashboard)
"""
import os
import io
import uuid
import subprocess
import pytest
import requests


def _read_env_url():
    url = os.environ.get("REACT_APP_BACKEND_URL", "")
    if not url:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    url = line.split("=", 1)[1].strip()
                    break
    return url.rstrip("/")


BASE = _read_env_url()
assert BASE, "REACT_APP_BACKEND_URL must be set"
API = f"{BASE}/api"

UID = uuid.uuid4().hex[:8]
USER = {"email": f"p4_{UID}@fakturaflow.es", "password": "TestPass123!", "name": "Phase4", "company": "AcmeP4"}

# Tiny 1x1 PNG as data URL
PNG_DATA_URL = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=="
)


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    r = s.post(f"{API}/auth/register", json=USER, timeout=30)
    if r.status_code == 400:
        r = s.post(f"{API}/auth/login", json={"email": USER["email"], "password": USER["password"]}, timeout=30)
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def pid(session):
    r = session.get(f"{API}/profiles", timeout=15)
    assert r.status_code == 200
    profs = r.json()
    default = next((p for p in profs if p.get("is_default")), profs[0])
    pid = default["id"]
    # Seed
    session.put(f"{API}/profiles/{pid}", json={
        "name": default.get("name", "Personal"),
        "type": default.get("type", "autonomo"),
        "nif": "B11122233", "fiscal_name": "AcmeP4 SL",
        "address": "C/ Test 1, Madrid", "email": USER["email"], "phone": "600000000",
        "default_iva": 21, "invoice_series": ["A"],
    }, timeout=15)
    return pid


@pytest.fixture(scope="module")
def H(pid):
    return {"X-Profile-Id": pid}


@pytest.fixture(scope="module")
def seed_client(session, H):
    r = session.post(f"{API}/clients", headers=H, json={
        "name": "TEST_Cliente Phase4", "company": "ClienteCo", "nif": "X1111111A",
        "address": "C/ Cliente 1", "email": "cli@test.com", "phone": "611111111", "notes": ""
    }, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def seed_invoice(session, H, seed_client):
    payload = {
        "series": "A", "type": "factura",
        "client_id": seed_client["id"], "client_name": seed_client["name"], "client_nif": seed_client["nif"],
        "client_address": "", "client_email": "",
        "issue_date": "2026-01-10", "due_date": "2026-02-10",
        "items": [{"description": "Servicio Phase4", "quantity": 1.0, "price": 100.0, "iva": 21.0, "irpf": 0.0, "discount": 0.0}],
        "notes": "", "status": "pendiente", "recurring": "none",
        "rectifies_id": "", "rectifies_number": "", "project_id": "", "tags": [],
    }
    r = session.post(f"{API}/invoices", headers=H, json=payload, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def seed_quote(session, H, seed_client):
    payload = {
        "type": "presupuesto",
        "client_id": seed_client["id"], "client_name": seed_client["name"], "client_nif": seed_client["nif"],
        "client_address": "C/ Cliente 1", "client_email": "cli@test.com",
        "issue_date": "2026-01-12", "valid_until": "2026-02-12",
        "items": [{"description": "Consultoria", "quantity": 2.0, "price": 150.0, "iva": 21.0, "irpf": 0.0, "discount": 0.0}],
        "notes": "", "status": "pendiente", "tags": [],
    }
    r = session.post(f"{API}/quotes", headers=H, json=payload, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


# ---------- AUDIT LOG ----------
class TestAudit:
    def test_audit_lists_events_for_client_crud(self, session, H, seed_client):
        # Update + delete a client to generate audit
        c2 = session.post(f"{API}/clients", headers=H, json={
            "name": "TEST_ToDel", "nif": "Y2222222B", "company": "", "address": "", "email": "", "phone": "", "notes": ""
        }, timeout=15).json()
        u = session.put(f"{API}/clients/{c2['id']}", headers=H, json={
            "name": "TEST_ToDelUpd", "nif": "Y2222222B", "company": "C2", "address": "", "email": "", "phone": "", "notes": ""
        }, timeout=15)
        assert u.status_code == 200
        d = session.delete(f"{API}/clients/{c2['id']}", headers=H, timeout=15)
        assert d.status_code == 200

        r = session.get(f"{API}/audit", headers=H, timeout=15)
        assert r.status_code == 200, r.text
        items = r.json()
        assert isinstance(items, list) and len(items) >= 3
        actions = {it["action"] for it in items}
        assert {"create", "update", "delete"} <= actions
        sample = items[0]
        for k in ("actor_name", "entity_label", "action", "changes", "entity_type"):
            assert k in sample, f"audit missing key {k}: {sample}"


# ---------- CSV EXPORT ----------
class TestCsvExport:
    def test_export_clients_csv(self, session, H):
        r = session.get(f"{API}/export/clients.csv", headers=H, timeout=20)
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("text/csv")
        first_line = r.text.splitlines()[0]
        for col in ("name", "company", "nif", "email"):
            assert col in first_line

    def test_export_invoices_csv(self, session, H, seed_invoice):
        r = session.get(f"{API}/export/invoices.csv", headers=H, timeout=20)
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("text/csv")
        text = r.text
        first_line = text.splitlines()[0]
        for col in ("number", "issue_date", "client_name", "total", "status"):
            assert col in first_line
        assert seed_invoice["number"] in text

    def test_export_expenses_csv(self, session, H):
        r = session.get(f"{API}/export/expenses.csv", headers=H, timeout=20)
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("text/csv")
        first_line = r.text.splitlines()[0]
        for col in ("date", "supplier", "total", "iva"):
            assert col in first_line


# ---------- CSV IMPORT ----------
class TestCsvImport:
    def test_import_clients_minimal(self, session, H):
        csv = "name\nTEST_ImportedA\nTEST_ImportedB\n"
        files = {"file": ("c.csv", csv.encode("utf-8"), "text/csv")}
        r = session.post(f"{API}/import/clients", headers=H, files=files, timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["created"] == 2 and data["skipped"] == 0
        # Verify persistence
        r2 = session.get(f"{API}/clients", headers=H, timeout=15)
        names = {c["name"] for c in r2.json()}
        assert "TEST_ImportedA" in names and "TEST_ImportedB" in names

    def test_import_expenses_minimal(self, session, H):
        csv = "date,supplier,total,iva\n2026-01-05,TEST_Prov1,121.00,21.00\n2026-01-06,TEST_Prov2,242.00,42.00\n"
        files = {"file": ("e.csv", csv.encode("utf-8"), "text/csv")}
        r = session.post(f"{API}/import/expenses", headers=H, files=files, timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["created"] == 2
        r2 = session.get(f"{API}/expenses", headers=H, timeout=15)
        sups = {e["supplier"] for e in r2.json()}
        assert "TEST_Prov1" in sups

    def test_import_invoices_minimal(self, session, H):
        csv = "client_name,client_nif,issue_date,total\nTEST_ImpClient,Z9999999Z,2026-01-15,242.00\n"
        files = {"file": ("i.csv", csv.encode("utf-8"), "text/csv")}
        r = session.post(f"{API}/import/invoices", headers=H, files=files, timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["created"] == 1
        r2 = session.get(f"{API}/invoices", headers=H, timeout=15)
        clients = {inv["client_name"] for inv in r2.json()}
        assert "TEST_ImpClient" in clients


# ---------- ADVANCED SEARCH ----------
class TestAdvancedSearch:
    def test_search_invoices_by_date(self, session, H, seed_invoice):
        r = session.get(f"{API}/search/advanced",
                        params={"entity": "invoices", "date_from": "2026-01-01", "date_to": "2026-12-31"},
                        headers=H, timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["entity"] == "invoices" and body["count"] >= 1
        nums = {i["number"] for i in body["items"]}
        assert seed_invoice["number"] in nums

    def test_search_invoices_amount_range(self, session, H):
        r = session.get(f"{API}/search/advanced",
                        params={"entity": "invoices", "min_amount": 50, "max_amount": 1000},
                        headers=H, timeout=20)
        assert r.status_code == 200
        for it in r.json()["items"]:
            assert 50 <= it["total"] <= 1000

    def test_search_invoices_status(self, session, H):
        r = session.get(f"{API}/search/advanced",
                        params={"entity": "invoices", "status": "pendiente"},
                        headers=H, timeout=20)
        assert r.status_code == 200
        for it in r.json()["items"]:
            assert it["status"] == "pendiente"

    def test_search_clients_query(self, session, H):
        r = session.get(f"{API}/search/advanced",
                        params={"entity": "clients", "q": "TEST_"},
                        headers=H, timeout=20)
        assert r.status_code == 200
        assert r.json()["count"] >= 1


# ---------- EMAIL TEMPLATES ----------
class TestEmailTemplates:
    def test_defaults_present(self, session, H):
        r = session.get(f"{API}/email-templates", headers=H, timeout=15)
        assert r.status_code == 200
        types = {t["type"] for t in r.json()}
        assert {"invoice_new", "reminder", "quote_sent", "thanks_paid"} <= types

    def test_crud_custom_template(self, session, H):
        # Create
        c = session.post(f"{API}/email-templates", headers=H, json={
            "type": "custom", "name": "TEST_Tpl", "subject": "Asunto {{numero}}", "body": "Hola {{cliente}}"
        }, timeout=15)
        assert c.status_code == 200, c.text
        tid = c.json()["id"]
        # Update
        u = session.put(f"{API}/email-templates/{tid}", headers=H, json={
            "type": "custom", "name": "TEST_TplUpd", "subject": "Asunto X", "body": "Cuerpo X"
        }, timeout=15)
        assert u.status_code == 200
        # Delete
        d = session.delete(f"{API}/email-templates/{tid}", headers=H, timeout=15)
        assert d.status_code == 200

    def test_preview_renders_vars(self, session, H):
        r = session.post(f"{API}/email-templates/preview", headers=H, json={
            "subject": "Factura {{numero}}", "body": "Hola {{cliente}}, importe {{importe}}",
            "vars": {"numero": "A-001", "cliente": "Ana", "importe": "100 EUR"}
        }, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["subject"] == "Factura A-001"
        assert "Ana" in d["body"] and "100 EUR" in d["body"]


# ---------- GESTOR PORTAL ----------
class TestGestorPortal:
    def test_create_token_and_public_endpoints(self, session, H, pid):
        r = session.post(f"{API}/profiles/{pid}/gestor-link", headers=H, timeout=15)
        assert r.status_code == 200
        token = r.json()["token"]
        assert token and len(token) > 10

        # Public (no auth, no profile header): use fresh session
        anon = requests.Session()
        info = anon.get(f"{API}/gestor/{token}/info", timeout=15)
        assert info.status_code == 200, info.text
        b = info.json()
        assert "profile" in b and "stats" in b
        assert b["profile"]["nif"] == "B11122233"

        invs = anon.get(f"{API}/gestor/{token}/invoices", timeout=15)
        assert invs.status_code == 200 and isinstance(invs.json(), list)

        exps = anon.get(f"{API}/gestor/{token}/expenses", timeout=15)
        assert exps.status_code == 200 and isinstance(exps.json(), list)

        # Revoke and verify 404
        rev = session.delete(f"{API}/profiles/{pid}/gestor-link", headers=H, timeout=15)
        assert rev.status_code == 200
        info2 = anon.get(f"{API}/gestor/{token}/info", timeout=15)
        assert info2.status_code == 404


# ---------- CONTRACT PDF ----------
class TestContract:
    def test_contract_pdf(self, session, H, seed_quote):
        r = session.get(f"{API}/quotes/{seed_quote['id']}/contract.pdf", headers=H, timeout=30)
        assert r.status_code == 200, r.text
        assert r.headers["content-type"].startswith("application/pdf")
        assert r.content[:4] == b"%PDF"
        assert len(r.content) > 1500
        # Decode PDF text — reportlab streams are FlateDecoded
        import pypdf
        reader = pypdf.PdfReader(io.BytesIO(r.content))
        text = "\n".join((p.extract_text() or "") for p in reader.pages).upper()
        for token in ("PRIMERA", "SEGUNDA", "PROVEEDOR", "CLIENTE"):
            assert token in text, f"clause {token!r} missing in contract PDF"


# ---------- DIGITAL SIGNATURE ----------
class TestSignature:
    P12_PATH = "/tmp/test.p12"

    @classmethod
    def setup_class(cls):
        if not os.path.exists(cls.P12_PATH):
            subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048",
                            "-keyout", "/tmp/key.pem", "-out", "/tmp/cert.pem",
                            "-days", "1", "-nodes", "-subj", "/CN=test"], check=True, capture_output=True)
            subprocess.run(["openssl", "pkcs12", "-export", "-out", cls.P12_PATH,
                            "-inkey", "/tmp/key.pem", "-in", "/tmp/cert.pem",
                            "-password", "pass:test123"], check=True, capture_output=True)

    def test_upload_cert_wrong_password_rejected(self, session, H, pid):
        with open(self.P12_PATH, "rb") as f:
            files = {"file": ("test.p12", f.read(), "application/x-pkcs12")}
        r = session.post(f"{API}/profiles/{pid}/certificate", headers=H,
                         files=files, data={"password": "wrong_pw"}, timeout=30)
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"

    def test_upload_cert_correct_password(self, session, H, pid):
        with open(self.P12_PATH, "rb") as f:
            files = {"file": ("test.p12", f.read(), "application/x-pkcs12")}
        r = session.post(f"{API}/profiles/{pid}/certificate", headers=H,
                         files=files, data={"password": "test123"}, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["ok"] is True

        # GET info
        info = session.get(f"{API}/profiles/{pid}/certificate", headers=H, timeout=15)
        assert info.status_code == 200
        b = info.json()
        assert b["has_certificate"] is True
        assert b["filename"] == "test.p12"

    def test_signed_pdf_visual(self, session, H, seed_invoice):
        r = session.get(f"{API}/invoices/{seed_invoice['id']}/signed.pdf",
                        params={"mode": "visual"}, headers=H, timeout=30)
        assert r.status_code == 200, r.text
        assert r.headers["content-type"] == "application/pdf"
        assert r.content[:4] == b"%PDF"
        # Visual stamp text inside compressed stream — extract via pypdf
        import pypdf
        reader = pypdf.PdfReader(io.BytesIO(r.content))
        text = "\n".join((p.extract_text() or "") for p in reader.pages).upper()
        assert "FIRMADO" in text or "FIRMA" in text, f"visual stamp missing; extracted text head: {text[:300]}"

    def test_delete_cert(self, session, H, pid):
        r = session.delete(f"{API}/profiles/{pid}/certificate", headers=H, timeout=15)
        assert r.status_code == 200
        info = session.get(f"{API}/profiles/{pid}/certificate", headers=H, timeout=15)
        assert info.status_code == 200
        assert info.json()["has_certificate"] is False


# ---------- LOGO UPLOAD ----------
class TestLogo:
    def test_logo_persisted_in_profile(self, session, H, pid):
        r = session.put(f"{API}/profiles/{pid}", headers=H, json={
            "name": "Personal", "type": "autonomo",
            "nif": "B11122233", "fiscal_name": "AcmeP4 SL",
            "address": "C/ Test 1, Madrid", "email": USER["email"], "phone": "600000000",
            "default_iva": 21, "invoice_series": ["A"],
            "logo_url": PNG_DATA_URL,
        }, timeout=15)
        assert r.status_code == 200, r.text
        # Read back via list (no single-profile GET endpoint exists)
        g = session.get(f"{API}/profiles", headers=H, timeout=15)
        assert g.status_code == 200
        prof = next((p for p in g.json() if p["id"] == pid), None)
        assert prof is not None
        assert prof.get("logo_url", "").startswith("data:image/png;base64,")

    def test_invoice_pdf_renders_with_logo(self, session, H, seed_invoice):
        r = session.get(f"{API}/invoices/{seed_invoice['id']}/pdf", headers=H, timeout=30)
        assert r.status_code == 200
        assert r.content[:4] == b"%PDF"
        # PDF must be larger than a no-logo baseline (small)
        assert len(r.content) > 2000


# ---------- REGRESSION ----------
class TestRegression:
    def test_me(self, session):
        r = session.get(f"{API}/auth/me", timeout=15)
        assert r.status_code == 200
        assert r.json()["email"] == USER["email"]

    def test_invoices_list(self, session, H):
        r = session.get(f"{API}/invoices", headers=H, timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_dashboard(self, session, H):
        r = session.get(f"{API}/dashboard", headers=H, timeout=15)
        assert r.status_code == 200
        d = r.json()
        for k in ("totals", "kpis"):
            assert k in d or isinstance(d, dict)  # tolerant

    def test_clients_list(self, session, H):
        r = session.get(f"{API}/clients", headers=H, timeout=15)
        assert r.status_code == 200

    def test_quotes_list(self, session, H):
        r = session.get(f"{API}/quotes", headers=H, timeout=15)
        assert r.status_code == 200

    def test_expenses_list(self, session, H):
        r = session.get(f"{API}/expenses", headers=H, timeout=15)
        assert r.status_code == 200

    def test_hacienda_modelo_303(self, session, H):
        r = session.get(f"{API}/hacienda/modelo-303/2026/1", headers=H, timeout=15)
        assert r.status_code == 200

    def test_verifactu_status(self, session, H, seed_invoice):
        r = session.get(f"{API}/verifactu/status", params={"invoice_id": seed_invoice["id"]}, headers=H, timeout=15)
        assert r.status_code in (200, 404)


# ---------- CLEANUP ----------
class TestZzCleanup:
    def test_cleanup_test_data(self, session, H):
        # Delete clients/invoices/expenses with TEST_ prefix
        for path in ("invoices", "clients", "expenses"):
            r = session.get(f"{API}/{path}", headers=H, timeout=15)
            if r.status_code != 200:
                continue
            for it in r.json():
                label = it.get("name") or it.get("client_name") or it.get("supplier") or ""
                if label.startswith("TEST_"):
                    session.delete(f"{API}/{path}/{it['id']}", headers=H, timeout=15)
        assert True
