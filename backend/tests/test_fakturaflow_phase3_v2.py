"""FakturaFlow Phase 3 v2 — backend tests for:
- Stripe subscription (plans, checkout, cancel)
- Verifactu QR + hash chain (private + public)
- Advisor IA (advisor-review)
- OCR advanced with duplicate detection
- Portal cliente (quote share + public action)
- Backup ZIP export
- Business health
- Reminders
- Profile scoping regression
- Public endpoints unauthenticated
"""
import os
import io
import json
import uuid
import zipfile
import hashlib
import pytest
import requests
from datetime import datetime


def _read_env_url():
    url = os.environ.get("REACT_APP_BACKEND_URL", "")
    if not url:
        try:
            with open("/app/frontend/.env") as f:
                for line in f:
                    if line.startswith("REACT_APP_BACKEND_URL="):
                        url = line.split("=", 1)[1].strip()
                        break
        except FileNotFoundError:
            pass
    return url.rstrip("/")


BASE = _read_env_url()
assert BASE, "REACT_APP_BACKEND_URL must be set"
API = f"{BASE}/api"

UID = uuid.uuid4().hex[:8]
USER = {"email": f"p3v2_{UID}@fakturaflow.es", "password": "TestPass123!", "name": "Phase3V2", "company": "AcmeP3V2"}


def _register(user):
    s = requests.Session()
    r = s.post(f"{API}/auth/register", json=user, timeout=30)
    if r.status_code == 400:
        r = s.post(f"{API}/auth/login", json={"email": user["email"], "password": user["password"]}, timeout=30)
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def session():
    return _register(USER)


@pytest.fixture(scope="module")
def profile_id(session):
    r = session.get(f"{API}/profiles", timeout=15)
    assert r.status_code == 200
    profs = r.json()
    default = next((p for p in profs if p.get("is_default")), profs[0])
    # Seed profile NIF / fiscal_name
    pid = default["id"]
    session.put(f"{API}/profiles/{pid}",
                json={"name": default.get("name", "Personal"), "type": default.get("type", "autonomo"),
                      "nif": "B99999999", "fiscal_name": "AcmeP3V2 SL", "default_iva": 21,
                      "invoice_series": ["A"]}, timeout=15)
    return pid


@pytest.fixture(scope="module")
def hdr(profile_id):
    return {"X-Profile-Id": profile_id}


@pytest.fixture(scope="module")
def client_id(session, hdr):
    r = session.post(f"{API}/clients", headers=hdr,
                     json={"name": "Cliente P3V2", "company": "ClienteP3V2", "nif": "B12345678",
                           "email": "cliente@example.com"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["id"]


# ============================================================
# SUBSCRIPTION
# ============================================================
def test_subscription_plans_list():
    """GET /api/subscription/plans (public-ish, but requires no auth?). Try with a session anyway."""
    s = requests.Session()
    r = s.get(f"{API}/subscription/plans", timeout=15)
    assert r.status_code == 200, r.text
    plans = r.json()
    for k in ("free", "pro", "business"):
        assert k in plans, f"plan {k} missing"
    assert plans["free"]["price"] == 0
    assert abs(plans["pro"]["price"] - 9.99) < 0.01
    assert abs(plans["business"]["price"] - 24.99) < 0.01


def test_subscription_get_default_free(session):
    r = session.get(f"{API}/subscription", timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["plan"] == "free"
    assert "usage" in d and "invoices_this_month" in d["usage"]
    assert "details" in d


def test_subscription_checkout_creates_session(session):
    payload = {"plan": "pro", "origin_url": "https://example.com"}
    r = session.post(f"{API}/subscription/checkout", json=payload, timeout=30)
    if r.status_code == 500 and "Stripe" in r.text:
        pytest.skip("Stripe not configured in this env")
    assert r.status_code == 200, r.text
    d = r.json()
    assert "url" in d and d["url"].startswith("http")
    assert "session_id" in d and len(d["session_id"]) > 0


def test_subscription_cancel_returns_to_free(session):
    r = session.post(f"{API}/subscription/cancel", timeout=15)
    assert r.status_code == 200, r.text
    assert r.json().get("plan") == "free"
    # Verify
    g = session.get(f"{API}/subscription", timeout=15).json()
    assert g["plan"] == "free"


# ============================================================
# VERIFACTU
# ============================================================
@pytest.fixture(scope="module")
def two_invoices(session, hdr, client_id):
    ids = []
    for i, date in enumerate(["2026-03-01", "2026-03-02"]):
        r = session.post(f"{API}/invoices", headers=hdr,
                         json={"client_id": client_id, "series": "A", "issue_date": date,
                               "due_date": "2099-12-31",
                               "items": [{"description": f"Servicio {i}", "quantity": 1,
                                          "price": 100 + i * 10, "iva": 21}],
                               "status": "pendiente"}, timeout=15)
        assert r.status_code == 200, r.text
        ids.append(r.json()["id"])
    return ids


def test_verifactu_first_invoice_zero_prev_hash(session, hdr, two_invoices):
    iid = two_invoices[0]
    r = session.post(f"{API}/invoices/{iid}/verifactu", headers=hdr, timeout=20)
    assert r.status_code == 200, r.text
    d = r.json()
    for k in ("verifactu_uuid", "verifactu_hash", "verifactu_prev_hash", "verifactu_qr", "qr_png_b64"):
        assert k in d, f"missing {k}"
    assert d["verifactu_prev_hash"] == "0" * 64
    assert len(d["verifactu_hash"]) == 64
    # QR PNG base64 starts with iVBOR (PNG header)
    import base64 as b64m
    raw = b64m.b64decode(d["qr_png_b64"])
    assert raw[:4] == b"\x89PNG"
    pytest.p3v2_first_hash = d["verifactu_hash"]
    pytest.p3v2_first_uuid = d["verifactu_uuid"]


def test_verifactu_second_invoice_chains(session, hdr, two_invoices):
    iid = two_invoices[1]
    r = session.post(f"{API}/invoices/{iid}/verifactu", headers=hdr, timeout=20)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["verifactu_prev_hash"] == pytest.p3v2_first_hash
    assert d["verifactu_hash"] != d["verifactu_prev_hash"]


def test_public_verifactu_unauthenticated():
    """PUBLIC endpoint must work WITHOUT session/cookies."""
    fresh = requests.Session()  # no cookies
    uid = pytest.p3v2_first_uuid
    r = fresh.get(f"{API}/public/verifactu/{uid}", timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["verified"] is True
    assert "number" in d and "total" in d and "hash" in d
    assert "emisor" in d


def test_public_verifactu_unknown_uuid_404():
    fresh = requests.Session()
    r = fresh.get(f"{API}/public/verifactu/{uuid.uuid4()}", timeout=15)
    assert r.status_code == 404


# ============================================================
# ADVISOR IA
# ============================================================
def test_advisor_review_returns_checks_and_ai(session, hdr):
    r = session.get(f"{API}/ai/advisor-review", headers=hdr,
                    params={"year": 2026, "quarter": 1}, timeout=60)
    if r.status_code == 500 and "Groq" in r.text:
        pytest.skip("Groq not configured")
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["year"] == 2026 and d["quarter"] == 1
    assert "checks" in d and isinstance(d["checks"], list)
    assert "ai_analysis" in d and isinstance(d["ai_analysis"], str) and len(d["ai_analysis"]) > 0
    assert "stats" in d
    for k in ("invoices", "expenses", "pending", "overdue"):
        assert k in d["stats"]


# ============================================================
# OCR ADVANCED (duplicate by file_hash)
# ============================================================
def test_ocr_advanced_duplicate_detection(session, hdr, profile_id):
    """Seed an expense with a known receipt_hash directly in Mongo, then verify endpoint detects duplicate."""
    import asyncio
    from motor.motor_asyncio import AsyncIOMotorClient

    img_bytes = b"\x89PNG\r\n\x1a\n" + b"FAKE-PNG-BYTES-DETERMINISTIC-" + b"x" * 200
    file_hash = hashlib.sha256(img_bytes).hexdigest()

    # Resolve current user_id from session
    me = session.get(f"{API}/auth/me", timeout=15)
    assert me.status_code == 200, me.text
    uid = me.json()["id"]

    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME")
    if not mongo_url or not db_name:
        # Fallback: read from backend/.env
        try:
            with open("/app/backend/.env") as f:
                for ln in f:
                    if ln.startswith("MONGO_URL="):
                        mongo_url = ln.split("=", 1)[1].strip().strip('"').strip("'")
                    if ln.startswith("DB_NAME="):
                        db_name = ln.split("=", 1)[1].strip().strip('"').strip("'")
        except FileNotFoundError:
            pass
    assert mongo_url and db_name, "MONGO_URL/DB_NAME must be available"

    eid = str(uuid.uuid4())

    async def _seed():
        c = AsyncIOMotorClient(mongo_url)
        try:
            await c[db_name].expenses.insert_one({
                "id": eid, "user_id": uid, "profile_id": profile_id,
                "description": "Ticket pre-seed OCR", "category": "Material",
                "amount": 12.5, "iva": 21, "date": "2026-03-05",
                "receipt_hash": file_hash, "created_at": datetime.now().isoformat(),
            })
        finally:
            c.close()

    asyncio.get_event_loop().run_until_complete(_seed()) if False else asyncio.new_event_loop().run_until_complete(_seed())

    # Now upload the same bytes; should detect duplicate WITHOUT calling Groq
    files = {"file": ("ticket.png", io.BytesIO(img_bytes), "image/png")}
    r = session.post(f"{API}/ai/ocr-receipt-advanced", files=files, headers=hdr, timeout=60)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d.get("duplicate") is True, f"Expected duplicate, got: {d}"
    assert d.get("existing_id") == eid
    assert "warning" in d
    # cleanup
    session.delete(f"{API}/expenses/{eid}", headers=hdr, timeout=15)


# ============================================================
# PORTAL CLIENTE
# ============================================================
@pytest.fixture(scope="module")
def quote_id(session, hdr, client_id):
    r = session.post(f"{API}/quotes", headers=hdr,
                     json={"client_id": client_id, "issue_date": "2026-03-10",
                           "valid_until": "2099-12-31",
                           "items": [{"description": "Consultoría", "quantity": 5, "price": 100, "iva": 21}],
                           "status": "pendiente"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def test_quote_share_returns_token_and_url(session, hdr, quote_id):
    r = session.post(f"{API}/quotes/{quote_id}/share", headers=hdr, timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert "token" in d and len(d["token"]) >= 16
    assert "url" in d and d["url"].endswith(d["token"])
    pytest.p3v2_quote_token = d["token"]


def test_public_quote_get_unauthenticated(quote_id):
    fresh = requests.Session()
    token = pytest.p3v2_quote_token
    r = fresh.get(f"{API}/public/quote/{token}", timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert "quote" in d
    assert d["quote"]["id"] == quote_id


def test_public_quote_action_accept_records_signature(session, hdr, quote_id):
    fresh = requests.Session()
    token = pytest.p3v2_quote_token
    r = fresh.post(f"{API}/public/quote/{token}/action",
                   json={"action": "accept", "signature": "JuanPerez", "comment": "Aprobado"},
                   timeout=15)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "aceptado"
    # Verify on owner side
    g = session.get(f"{API}/quotes/{quote_id}", headers=hdr, timeout=15)
    assert g.status_code == 200
    q = g.json()
    assert q["status"] == "aceptado"
    assert q.get("public_signature") == "JuanPerez"
    assert q.get("public_comment") == "Aprobado"


# ============================================================
# BACKUP
# ============================================================
def test_backup_export_zip(session, hdr):
    r = session.get(f"{API}/backup/export", headers=hdr, timeout=60)
    assert r.status_code == 200, r.text[:300]
    assert r.headers.get("content-type", "").startswith("application/zip")
    z = zipfile.ZipFile(io.BytesIO(r.content))
    names = z.namelist()
    expected = ["clients.json", "invoices.json", "expenses.json", "quotes.json",
                "projects.json", "time_entries.json", "payments.json",
                "profile.json", "export-meta.json"]
    for n in expected:
        assert n in names, f"missing {n} in {names}"
    assert len(names) >= 7
    meta = json.loads(z.read("export-meta.json").decode())
    assert "exported_at" in meta and "version" in meta
    invs = json.loads(z.read("invoices.json").decode())
    assert isinstance(invs, list)


# ============================================================
# HEALTH
# ============================================================
def test_business_health_scores(session, hdr):
    r = session.get(f"{API}/analytics/health", headers=hdr, timeout=20)
    assert r.status_code == 200, r.text
    d = r.json()
    assert "overall_score" in d and isinstance(d["overall_score"], (int, float))
    for k in ("liquidity", "growth", "client_diversification", "stability"):
        assert k in d["scores"]
        assert isinstance(d["scores"][k], (int, float))
    # 0..100 bound for non-growth scores
    for k in ("liquidity", "client_diversification", "stability"):
        assert 0 <= d["scores"][k] <= 100, f"{k}={d['scores'][k]} out of range"
    for k in ("pending_amount", "cash_in_year", "top_client_share_pct", "growth_yoy_pct", "num_clients"):
        assert k in d["metrics"]


# ============================================================
# REMINDERS
# ============================================================
def test_reminders_returns_list(session, hdr):
    r = session.get(f"{API}/reminders", headers=hdr, timeout=20)
    assert r.status_code == 200, r.text
    d = r.json()
    assert isinstance(d, list)
    for item in d:
        for k in ("id", "type", "title", "detail", "action"):
            assert k in item, f"reminder missing {k}: {item}"


def test_reminders_includes_overdue_when_present(session, hdr, client_id):
    """Create an overdue invoice and verify it shows up."""
    inv = session.post(f"{API}/invoices", headers=hdr,
                       json={"client_id": client_id, "series": "A", "issue_date": "2024-01-01",
                             "due_date": "2024-01-15",
                             "items": [{"description": "Old", "quantity": 1, "price": 50, "iva": 21}],
                             "status": "vencida"}, timeout=15)
    assert inv.status_code == 200, inv.text
    iid = inv.json()["id"]
    r = session.get(f"{API}/reminders", headers=hdr, timeout=20)
    assert r.status_code == 200
    d = r.json()
    assert any(it["id"] == "overdue" for it in d), f"no overdue reminder: {d}"
    session.delete(f"{API}/invoices/{iid}", headers=hdr, timeout=15)


# ============================================================
# PROFILE SCOPING REGRESSION
# ============================================================
def test_profile_scoping_subscription_and_health(session, hdr):
    """All non-public Phase 3 endpoints must accept X-Profile-Id without 4xx."""
    endpoints = [
        ("GET", "/subscription"),
        ("GET", "/analytics/health"),
        ("GET", "/reminders"),
        ("GET", "/backup/export"),
    ]
    for method, ep in endpoints:
        r = session.request(method, f"{API}{ep}", headers=hdr, timeout=30)
        assert r.status_code == 200, f"{method} {ep} -> {r.status_code} {r.text[:200]}"


def test_phase1_endpoints_still_work(session, hdr):
    """Regression: phase 1+2 endpoints continue to work."""
    for ep in ("/dashboard", "/clients", "/invoices", "/expenses", "/quotes"):
        r = session.get(f"{API}{ep}", headers=hdr, timeout=15)
        assert r.status_code == 200, f"{ep} broken: {r.status_code} {r.text[:200]}"


# ============================================================
# CLEANUP
# ============================================================
def test_zz_cleanup(session, hdr, client_id, two_invoices, quote_id):
    for iid in two_invoices:
        session.delete(f"{API}/invoices/{iid}", headers=hdr, timeout=15)
    session.delete(f"{API}/quotes/{quote_id}", headers=hdr, timeout=15)
    session.delete(f"{API}/clients/{client_id}", headers=hdr, timeout=15)
