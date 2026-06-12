"""FakturaFlow Phase 3 backend tests:
Profiles CRUD + scoping, Projects, Time entries (+ convert-to-invoice),
Tags, Documents (base64), Modelos AEAT PDF (303/130/390), ZIP Preparar trimestre.
"""
import os
import io
import json
import uuid
import zipfile
import pytest
import requests

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
USER = {"email": f"p3_{UID}@fakturaflow.es", "password": "TestPass123!", "name": "Phase3", "company": "AcmeP3"}


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
def profiles(session):
    """Returns list of profiles after creating a 2nd one. profiles[0]=default, profiles[1]=secondary."""
    r = session.get(f"{API}/profiles", timeout=15)
    assert r.status_code == 200, r.text
    profs = r.json()
    assert len(profs) >= 1, "At least one default profile expected"
    default = next((p for p in profs if p.get("is_default")), profs[0])

    # Create a 2nd profile
    payload = {"name": "Segunda Empresa", "type": "sl", "nif": "B11111111", "default_iva": 21, "invoice_series": ["B"]}
    r2 = session.post(f"{API}/profiles", json=payload, timeout=15)
    assert r2.status_code == 200, r2.text
    second = r2.json()
    assert second["name"] == "Segunda Empresa"
    assert second.get("is_default") is False
    assert second["next_quote"] == 1
    assert second["next_number"].get("B") == 1
    return {"default": default, "second": second}


# ---------- PROFILES CRUD ----------
def test_list_profiles_returns_default(session):
    r = session.get(f"{API}/profiles", timeout=15)
    assert r.status_code == 200
    profs = r.json()
    assert len(profs) >= 1
    assert any(p.get("is_default") for p in profs)


def test_update_profile(session, profiles):
    pid = profiles["second"]["id"]
    payload = {"name": "Segunda SL", "type": "sl", "nif": "B22222222", "default_iva": 10, "invoice_series": ["B"]}
    r = session.put(f"{API}/profiles/{pid}", json=payload, timeout=15)
    assert r.status_code == 200
    # Verify persistence
    profs = session.get(f"{API}/profiles", timeout=15).json()
    p = next(p for p in profs if p["id"] == pid)
    assert p["name"] == "Segunda SL"
    assert p["nif"] == "B22222222"


def test_set_default_profile(session, profiles):
    pid = profiles["second"]["id"]
    r = session.post(f"{API}/profiles/{pid}/set-default", timeout=15)
    assert r.status_code == 200
    profs = session.get(f"{API}/profiles", timeout=15).json()
    defaults = [p for p in profs if p.get("is_default")]
    assert len(defaults) == 1
    assert defaults[0]["id"] == pid
    # Restore default to original
    session.post(f"{API}/profiles/{profiles['default']['id']}/set-default", timeout=15)


def test_cannot_delete_only_profile():
    """Fresh user with only the default profile -> DELETE returns 400."""
    user = {"email": f"p3_only_{uuid.uuid4().hex[:8]}@fakturaflow.es",
            "password": "TestPass123!", "name": "OnlyOne"}
    s = _register(user)
    profs = s.get(f"{API}/profiles", timeout=15).json()
    assert len(profs) == 1
    r = s.delete(f"{API}/profiles/{profs[0]['id']}", timeout=15)
    assert r.status_code == 400


# ---------- PROFILE SCOPING (CRITICAL) ----------
@pytest.fixture(scope="module")
def client_in_default(session, profiles):
    payload = {"name": "ClienteA", "company": "EmpresaA", "nif": "B10000001"}
    headers = {"X-Profile-Id": profiles["default"]["id"]}
    r = session.post(f"{API}/clients", json=payload, headers=headers, timeout=15)
    assert r.status_code == 200, r.text
    cid = r.json()["id"]
    assert r.json().get("profile_id") == profiles["default"]["id"]
    return cid


@pytest.fixture(scope="module")
def client_in_second(session, profiles):
    payload = {"name": "ClienteB", "company": "EmpresaB", "nif": "B20000002"}
    headers = {"X-Profile-Id": profiles["second"]["id"]}
    r = session.post(f"{API}/clients", json=payload, headers=headers, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def test_clients_isolated_between_profiles(session, profiles, client_in_default, client_in_second):
    h_default = {"X-Profile-Id": profiles["default"]["id"]}
    h_second = {"X-Profile-Id": profiles["second"]["id"]}
    r1 = session.get(f"{API}/clients", headers=h_default, timeout=15).json()
    r2 = session.get(f"{API}/clients", headers=h_second, timeout=15).json()
    ids1 = [c["id"] for c in r1]
    ids2 = [c["id"] for c in r2]
    assert client_in_default in ids1 and client_in_default not in ids2
    assert client_in_second in ids2 and client_in_second not in ids1


def test_invoice_isolated_between_profiles(session, profiles, client_in_default):
    h_default = {"X-Profile-Id": profiles["default"]["id"]}
    h_second = {"X-Profile-Id": profiles["second"]["id"]}
    payload = {"client_id": client_in_default, "series": "A", "issue_date": "2026-02-01", "due_date": "2099-12-31",
               "items": [{"description": "X", "quantity": 1, "price": 50, "iva": 21}], "status": "pendiente"}
    r = session.post(f"{API}/invoices", json=payload, headers=h_default, timeout=15)
    assert r.status_code == 200, r.text
    inv_id = r.json()["id"]
    assert r.json().get("profile_id") == profiles["default"]["id"]
    # Profile B should not see it
    list_b = session.get(f"{API}/invoices", headers=h_second, timeout=15).json()
    assert inv_id not in [i["id"] for i in list_b]
    # GET by id from profile B -> 404
    r404 = session.get(f"{API}/invoices/{inv_id}", headers=h_second, timeout=15)
    assert r404.status_code == 404


def test_expense_isolated_between_profiles(session, profiles):
    h_default = {"X-Profile-Id": profiles["default"]["id"]}
    h_second = {"X-Profile-Id": profiles["second"]["id"]}
    payload = {"description": "Material P3", "category": "Material", "amount": 30, "iva": 21, "date": "2026-02-10"}
    r = session.post(f"{API}/expenses", json=payload, headers=h_default, timeout=15)
    assert r.status_code == 200, r.text
    eid = r.json()["id"]
    list_b = session.get(f"{API}/expenses", headers=h_second, timeout=15).json()
    assert eid not in [e["id"] for e in list_b]


# ---------- PROJECTS ----------
@pytest.fixture(scope="module")
def project_id(session, profiles, client_in_default):
    h = {"X-Profile-Id": profiles["default"]["id"]}
    payload = {"name": "Proyecto P3", "client_id": client_in_default, "hourly_rate": 50, "budget": 1000}
    r = session.post(f"{API}/projects", json=payload, headers=h, timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["hourly_rate"] == 50
    return d["id"]


def test_list_projects_with_stats(session, profiles, project_id):
    h = {"X-Profile-Id": profiles["default"]["id"]}
    r = session.get(f"{API}/projects", headers=h, timeout=15)
    assert r.status_code == 200
    projects = r.json()
    p = next((x for x in projects if x["id"] == project_id), None)
    assert p is not None
    assert "stats" in p
    for k in ("invoiced", "expenses", "hours", "invoices_count"):
        assert k in p["stats"]


def test_get_project_aggregate(session, profiles, project_id):
    h = {"X-Profile-Id": profiles["default"]["id"]}
    r = session.get(f"{API}/projects/{project_id}", headers=h, timeout=15)
    assert r.status_code == 200
    d = r.json()
    for k in ("invoices", "expenses", "time_entries"):
        assert k in d and isinstance(d[k], list)


def test_update_project(session, profiles, project_id, client_in_default):
    h = {"X-Profile-Id": profiles["default"]["id"]}
    payload = {"name": "Proyecto P3 v2", "client_id": client_in_default, "hourly_rate": 60, "budget": 1500}
    r = session.put(f"{API}/projects/{project_id}", json=payload, headers=h, timeout=15)
    assert r.status_code == 200
    got = session.get(f"{API}/projects/{project_id}", headers=h, timeout=15).json()
    assert got["name"] == "Proyecto P3 v2"
    assert got["hourly_rate"] == 60


# ---------- TIME ENTRIES ----------
@pytest.fixture(scope="module")
def time_entry_ids(session, profiles, project_id):
    h = {"X-Profile-Id": profiles["default"]["id"]}
    ids = []
    # First entry uses project's hourly_rate (60 after update)
    r = session.post(f"{API}/time-entries", headers=h,
                     json={"project_id": project_id, "description": "Reunión",
                           "duration_minutes": 90, "date": "2026-02-12"}, timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert abs(d["amount"] - (90 / 60) * 60) < 0.01  # 90 EUR
    assert d["hourly_rate"] == 60
    assert d["billed"] is False
    ids.append(d["id"])
    # Second entry overrides hourly_rate
    r2 = session.post(f"{API}/time-entries", headers=h,
                      json={"project_id": project_id, "description": "Dev",
                            "duration_minutes": 120, "date": "2026-02-13", "hourly_rate": 75}, timeout=15)
    assert r2.status_code == 200, r2.text
    d2 = r2.json()
    assert abs(d2["amount"] - 150) < 0.01
    ids.append(d2["id"])
    return ids


def test_list_time_entries(session, profiles, time_entry_ids, project_id):
    h = {"X-Profile-Id": profiles["default"]["id"]}
    r = session.get(f"{API}/time-entries", headers=h, params={"project_id": project_id}, timeout=15)
    assert r.status_code == 200
    ids = [t["id"] for t in r.json()]
    for tid in time_entry_ids:
        assert tid in ids


def test_convert_time_to_invoice(session, profiles, time_entry_ids, client_in_default):
    h = {"X-Profile-Id": profiles["default"]["id"]}
    payload = {"time_entry_ids": time_entry_ids, "client_id": client_in_default,
               "series": "A", "iva": 21, "irpf": 0}
    r = session.post(f"{API}/time-entries/convert-to-invoice", json=payload, headers=h, timeout=20)
    assert r.status_code == 200, r.text
    inv = r.json()
    assert inv["client_id"] == client_in_default
    assert len(inv["items"]) == 2
    assert all("h)" in it["description"] for it in inv["items"])
    # subtotal = 90 + 150 = 240
    assert abs(inv["subtotal"] - 240) < 0.5
    # Mark entries as billed
    list_r = session.get(f"{API}/time-entries", headers=h, timeout=15).json()
    for tid in time_entry_ids:
        e = next(t for t in list_r if t["id"] == tid)
        assert e["billed"] is True
        assert e.get("invoice_id") == inv["id"]
    pytest.p3_converted_invoice_id = inv["id"]


# ---------- TAGS ----------
def test_tags_aggregation(session, profiles):
    h = {"X-Profile-Id": profiles["default"]["id"]}
    # Create clients with tags
    r = session.post(f"{API}/clients", headers=h,
                     json={"name": "VIP1", "tags": ["vip", "recurrente"]}, timeout=15)
    assert r.status_code == 200
    c1 = r.json()["id"]
    assert r.json()["tags"] == ["vip", "recurrente"]
    r2 = session.post(f"{API}/clients", headers=h,
                      json={"name": "VIP2", "tags": ["vip"]}, timeout=15)
    assert r2.status_code == 200
    c2 = r2.json()["id"]

    rt = session.get(f"{API}/tags", headers=h, params={"entity": "client"}, timeout=15)
    assert rt.status_code == 200
    tags = rt.json()
    by = {t["tag"]: t["count"] for t in tags}
    assert by.get("vip", 0) >= 2
    assert by.get("recurrente", 0) >= 1
    # Sorted by count desc
    counts = [t["count"] for t in tags]
    assert counts == sorted(counts, reverse=True)
    # cleanup
    session.delete(f"{API}/clients/{c1}", headers=h, timeout=15)
    session.delete(f"{API}/clients/{c2}", headers=h, timeout=15)


def test_tags_on_invoice(session, profiles, client_in_default):
    h = {"X-Profile-Id": profiles["default"]["id"]}
    payload = {"client_id": client_in_default, "series": "A", "issue_date": "2026-02-15", "due_date": "2099-12-31",
               "items": [{"description": "T", "quantity": 1, "price": 10, "iva": 21}],
               "status": "pendiente", "tags": ["urgente"]}
    r = session.post(f"{API}/invoices", json=payload, headers=h, timeout=15)
    assert r.status_code == 200, r.text
    assert "urgente" in (r.json().get("tags") or [])
    iid = r.json()["id"]
    rt = session.get(f"{API}/tags", headers=h, params={"entity": "invoice"}, timeout=15)
    assert any(t["tag"] == "urgente" for t in rt.json())
    session.delete(f"{API}/invoices/{iid}", headers=h, timeout=15)


# ---------- DOCUMENTS ----------
def test_document_upload_list_download_delete(session, profiles, client_in_default):
    h = {"X-Profile-Id": profiles["default"]["id"]}
    file_bytes = b"PDF-FAKE-CONTENT-FOR-TESTING-" + b"x" * 1000
    files = {"file": ("test.pdf", io.BytesIO(file_bytes), "application/pdf")}
    data = {"entity_type": "client", "entity_id": client_in_default}
    r = session.post(f"{API}/documents", files=files, data=data, headers=h, timeout=20)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["filename"] == "test.pdf"
    assert d["size"] == len(file_bytes)
    assert "data_b64" not in d  # response should hide base64
    did = d["id"]

    # List
    rl = session.get(f"{API}/documents", headers=h,
                     params={"entity_type": "client", "entity_id": client_in_default}, timeout=15)
    assert rl.status_code == 200
    docs = rl.json()
    assert any(x["id"] == did for x in docs)
    assert all("data_b64" not in x for x in docs)

    # Download
    rd = session.get(f"{API}/documents/{did}", headers=h, timeout=20)
    assert rd.status_code == 200
    assert rd.headers.get("content-type", "").startswith("application/pdf")
    assert rd.content == file_bytes

    # Delete
    rdel = session.delete(f"{API}/documents/{did}", headers=h, timeout=15)
    assert rdel.status_code == 200
    rl2 = session.get(f"{API}/documents", headers=h,
                      params={"entity_type": "client", "entity_id": client_in_default}, timeout=15).json()
    assert not any(x["id"] == did for x in rl2)


def test_document_invalid_entity_type(session, profiles, client_in_default):
    h = {"X-Profile-Id": profiles["default"]["id"]}
    files = {"file": ("a.txt", io.BytesIO(b"hi"), "text/plain")}
    data = {"entity_type": "garbage", "entity_id": client_in_default}
    r = session.post(f"{API}/documents", files=files, data=data, headers=h, timeout=15)
    assert r.status_code == 400


# ---------- MODELOS PDF ----------
def test_modelo_303_pdf(session, profiles):
    h = {"X-Profile-Id": profiles["default"]["id"]}
    r = session.get(f"{API}/hacienda/modelo-303/2026/1", headers=h, timeout=30)
    assert r.status_code == 200, r.text[:200]
    assert r.headers.get("content-type", "").startswith("application/pdf")
    assert r.content[:4] == b"%PDF"


def test_modelo_130_pdf(session, profiles):
    h = {"X-Profile-Id": profiles["default"]["id"]}
    r = session.get(f"{API}/hacienda/modelo-130/2026/1", headers=h, timeout=30)
    assert r.status_code == 200
    assert r.headers.get("content-type", "").startswith("application/pdf")
    assert r.content[:4] == b"%PDF"


def test_modelo_390_pdf(session, profiles):
    h = {"X-Profile-Id": profiles["default"]["id"]}
    r = session.get(f"{API}/hacienda/modelo-390/2026", headers=h, timeout=30)
    assert r.status_code == 200
    assert r.headers.get("content-type", "").startswith("application/pdf")
    assert r.content[:4] == b"%PDF"


# ---------- ZIP PREPARAR TRIMESTRE ----------
def test_preparar_trimestre_zip(session, profiles):
    h = {"X-Profile-Id": profiles["default"]["id"]}
    r = session.get(f"{API}/hacienda/preparar-trimestre/2026/1", headers=h, timeout=60)
    assert r.status_code == 200, r.text[:200]
    assert r.headers.get("content-type", "").startswith("application/zip")
    z = zipfile.ZipFile(io.BytesIO(r.content))
    names = z.namelist()
    expected_prefixes = [
        "libro-ingresos-", "libro-gastos-",
        "iva-repercutido-", "iva-soportado-",
        "modelo-303-", "modelo-130-", "resumen-",
    ]
    for prefix in expected_prefixes:
        assert any(n.startswith(prefix) for n in names), f"missing {prefix} in {names}"
    assert len(names) >= 7
    # resumen JSON parses
    resumen_name = next(n for n in names if n.startswith("resumen-"))
    payload = json.loads(z.read(resumen_name).decode("utf-8"))
    assert payload["year"] == 2026 and payload["quarter"] == 1
    assert "totals" in payload


# ---------- MIGRATION (existing user has default profile) ----------
def test_existing_user_has_default_profile():
    """Re-login the same user in a NEW session and confirm default profile present."""
    s = _register(USER)  # idempotent: returns login if already exists
    r = s.get(f"{API}/profiles", timeout=15)
    assert r.status_code == 200
    profs = r.json()
    assert any(p.get("is_default") for p in profs)


# ---------- REGRESSION: no header still works (default profile) ----------
def test_no_header_falls_back_to_default(session):
    # Without X-Profile-Id, dashboard should still respond with the default profile data
    r = session.get(f"{API}/dashboard", timeout=15)
    assert r.status_code == 200


def test_clients_have_profile_id_field(session, profiles):
    h = {"X-Profile-Id": profiles["default"]["id"]}
    r = session.get(f"{API}/clients", headers=h, timeout=15)
    assert r.status_code == 200
    if r.json():
        assert all(c.get("profile_id") == profiles["default"]["id"] for c in r.json())


# ---------- CLEANUP ----------
def test_zz_cleanup(session, profiles, project_id, client_in_default, client_in_second):
    h_default = {"X-Profile-Id": profiles["default"]["id"]}
    h_second = {"X-Profile-Id": profiles["second"]["id"]}
    if hasattr(pytest, "p3_converted_invoice_id"):
        session.delete(f"{API}/invoices/{pytest.p3_converted_invoice_id}", headers=h_default, timeout=15)
    session.delete(f"{API}/projects/{project_id}", headers=h_default, timeout=15)
    session.delete(f"{API}/clients/{client_in_default}", headers=h_default, timeout=15)
    session.delete(f"{API}/clients/{client_in_second}", headers=h_second, timeout=15)
    # delete the secondary profile (default still exists)
    session.delete(f"{API}/profiles/{profiles['second']['id']}", timeout=15)
