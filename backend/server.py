from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
import io
import uuid
import base64
import json
import logging
import zipfile
import hashlib
import secrets
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Literal

import bcrypt
import jwt as pyjwt
from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends, UploadFile, File, Form, Header
from fastapi.responses import StreamingResponse
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr
from groq import Groq
import pypdfium2 as pdfium

try:
    import qrcode  # type: ignore
except Exception:
    qrcode = None  # type: ignore

try:
    import resend  # type: ignore
except Exception:
    resend = None  # type: ignore

try:
    from emergentintegrations.payments.stripe.checkout import StripeCheckout, CheckoutSessionRequest  # type: ignore
    STRIPE_AVAILABLE = True
except Exception:
    StripeCheckout = None  # type: ignore
    CheckoutSessionRequest = None  # type: ignore
    STRIPE_AVAILABLE = False

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

JWT_SECRET = os.environ.get("JWT_SECRET", "dev-secret")
JWT_ALGORITHM = "HS256"
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
groq_client = Groq(api_key=GROQ_API_KEY) if GROQ_API_KEY else None
GROQ_VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct"
GROQ_TEXT_MODEL = "llama-3.3-70b-versatile"

STRIPE_API_KEY = os.environ.get("STRIPE_API_KEY", "")
RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
if RESEND_API_KEY and not RESEND_API_KEY.startswith("re_demo"):
    resend.api_key = RESEND_API_KEY

# Subscription plans (fixed server-side; never accept prices from frontend)
PLANS = {
    "free": {"name": "Free", "price": 0.0, "max_invoices_month": 10, "max_profiles": 1, "features": ["facturas básicas", "OCR", "Asistente IA"]},
    "pro": {"name": "Pro", "price": 9.99, "max_invoices_month": -1, "max_profiles": 1, "features": ["Facturas ilimitadas", "Modelos Hacienda PDF", "ZIP gestor", "Verifactu QR", "Email cliente"]},
    "business": {"name": "Business", "price": 24.99, "max_invoices_month": -1, "max_profiles": -1, "features": ["Todo lo de Pro", "Multi-empresa ilimitado", "Portal cliente", "Backups automáticos", "Modo asesor IA"]},
}

OWNER_EMAILS = {e.strip().lower() for e in (os.environ.get("OWNER_EMAIL") or "").split(",") if e.strip()}


DEFAULT_ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "https://flowbilling-no-emergent.vercel.app",
]
ALLOWED_ORIGINS = [
    origin.strip().rstrip("/")
    for origin in os.environ.get("CORS_ORIGINS", os.environ.get("FRONTEND_URL", "")).split(",")
    if origin.strip()
] or DEFAULT_ALLOWED_ORIGINS
CORS_ORIGIN_REGEX = os.environ.get("CORS_ORIGIN_REGEX", r"https://.*\.vercel\.app")


def is_owner(user: dict) -> bool:
    return bool(user) and (user.get("email") or "").lower() in OWNER_EMAILS

app = FastAPI(title="FakturaFlow API")
api = APIRouter(prefix="/api")
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("fakturaflow")


# ---------- Helpers ----------
def hash_password(p: str) -> str:
    return bcrypt.hashpw(p.encode(), bcrypt.gensalt()).decode()


def verify_password(p: str, h: str) -> bool:
    try:
        return bcrypt.checkpw(p.encode(), h.encode())
    except Exception:
        return False


def create_token(user_id: str, email: str, kind: str = "access") -> str:
    delta = timedelta(minutes=60 * 24) if kind == "access" else timedelta(days=7)
    payload = {"sub": user_id, "email": email, "exp": datetime.now(timezone.utc) + delta, "type": kind}
    return pyjwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def set_auth_cookies(resp: Response, access: str, refresh: str):
    common = dict(httponly=True, secure=True, samesite="none", path="/")
    resp.set_cookie("access_token", access, max_age=86400, **common)
    resp.set_cookie("refresh_token", refresh, max_age=604800, **common)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(401, "No autenticado")
    try:
        payload = pyjwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
        if not user:
            raise HTTPException(401, "Usuario no encontrado")
        return user
    except pyjwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expirado")
    except pyjwt.InvalidTokenError:
        raise HTTPException(401, "Token inválido")


async def ensure_default_profile(user_id: str, name: str = "Personal") -> dict:
    """Ensure user has at least one profile; returns the default one."""
    p = await db.profiles.find_one({"user_id": user_id, "is_default": True}, {"_id": 0})
    if p:
        return p
    # Maybe existing profile but not flagged default
    any_p = await db.profiles.find_one({"user_id": user_id}, {"_id": 0})
    if any_p:
        await db.profiles.update_one({"id": any_p["id"]}, {"$set": {"is_default": True}})
        any_p["is_default"] = True
        return any_p
    pid = str(uuid.uuid4())
    profile = {
        "id": pid, "user_id": user_id, "name": name, "type": "autonomo",
        "fiscal_name": name, "nif": "", "address": "", "phone": "", "email": "",
        "logo_url": "", "signature": "", "default_iva": 21, "default_irpf": 0,
        "invoice_series": ["A"], "primary_color": "#2563EB",
        "next_number": {"A": 1}, "next_quote": 1,
        "is_default": True, "created_at": now_iso(),
    }
    await db.profiles.insert_one(profile)
    return profile


async def get_user_context(request: Request, x_profile_id: Optional[str] = Header(None, alias="X-Profile-Id")) -> dict:
    user = await get_current_user(request)
    profile = None
    if x_profile_id:
        profile = await db.profiles.find_one({"id": x_profile_id, "user_id": user["id"]}, {"_id": 0})
    if not profile:
        profile = await ensure_default_profile(user["id"], user.get("company") or user.get("name") or "Personal")
    return {"user": user, "profile": profile, "uid": user["id"], "pid": profile["id"]}


def scope(ctx, extra=None):
    """Returns base query dict scoped by user + profile."""
    q = {"user_id": ctx["uid"], "profile_id": ctx["pid"]}
    if extra:
        q.update(extra)
    return q


def calculate_totals(items: List[dict]):
    subtotal = 0.0
    iva_total = 0.0
    irpf_total = 0.0
    for it in items:
        line = (it.get("quantity", 0) or 0) * (it.get("price", 0) or 0)
        disc = line * ((it.get("discount", 0) or 0) / 100)
        net = line - disc
        subtotal += net
        iva_total += net * ((it.get("iva", 0) or 0) / 100)
        irpf_total += net * ((it.get("irpf", 0) or 0) / 100)
    total = subtotal + iva_total - irpf_total
    return {"subtotal": round(subtotal, 2), "iva_total": round(iva_total, 2),
            "irpf_total": round(irpf_total, 2), "total": round(total, 2)}


async def next_invoice_number(profile_id: str, series: str) -> str:
    p = await db.profiles.find_one({"id": profile_id}, {"_id": 0}) or {}
    nums = p.get("next_number", {})
    n = nums.get(series, 1)
    nums[series] = n + 1
    await db.profiles.update_one({"id": profile_id}, {"$set": {"next_number": nums}})
    return f"{series}-{datetime.now().year}-{n:04d}"


async def next_quote_number(profile_id: str) -> str:
    p = await db.profiles.find_one({"id": profile_id}, {"_id": 0}) or {}
    n = p.get("next_quote", 1)
    await db.profiles.update_one({"id": profile_id}, {"$set": {"next_quote": n + 1}})
    return f"P-{datetime.now().year}-{n:04d}"


async def recompute_invoice_status(inv: dict) -> dict:
    paid = inv.get("paid_amount", 0)
    total = inv.get("total", 0)
    new_status = inv.get("status", "pendiente")
    today = datetime.now().date().isoformat()
    if total > 0 and paid >= total - 0.01:
        new_status = "pagada"
    elif inv.get("due_date") and inv["due_date"] < today and paid < total - 0.01:
        new_status = "vencida"
    elif new_status == "pagada" and paid < total - 0.01:
        new_status = "pendiente"
    if new_status != inv.get("status"):
        await db.invoices.update_one({"id": inv["id"]}, {"$set": {"status": new_status}})
        inv["status"] = new_status
    return inv


# ---------- Models ----------
class RegisterIn(BaseModel):
    email: EmailStr; password: str; name: str; company: Optional[str] = ""

class LoginIn(BaseModel):
    email: EmailStr; password: str

class ProfileIn(BaseModel):
    name: str
    type: Literal["autonomo", "sl", "freelance", "otros"] = "autonomo"
    fiscal_name: Optional[str] = ""
    nif: Optional[str] = ""
    address: Optional[str] = ""
    phone: Optional[str] = ""
    email: Optional[str] = ""
    logo_url: Optional[str] = ""
    signature: Optional[str] = ""
    default_iva: float = 21
    default_irpf: float = 0
    invoice_series: List[str] = ["A"]
    primary_color: str = "#2563EB"
    bank_iban: Optional[str] = ""
    bank_name: Optional[str] = ""
    bank_swift: Optional[str] = ""

class ClientIn(BaseModel):
    name: str
    company: Optional[str] = ""
    nif: Optional[str] = ""
    address: Optional[str] = ""
    email: Optional[str] = ""
    phone: Optional[str] = ""
    notes: Optional[str] = ""
    tags: List[str] = []

class InvoiceItem(BaseModel):
    description: str; quantity: float = 1; price: float = 0
    iva: float = 21; irpf: float = 0; discount: float = 0

class InvoiceIn(BaseModel):
    client_id: str; series: str = "A"; issue_date: str
    due_date: Optional[str] = None
    items: List[InvoiceItem]
    notes: Optional[str] = ""
    status: Literal["pendiente", "pagada", "vencida"] = "pendiente"
    recurring: Optional[Literal["none", "weekly", "monthly", "yearly"]] = "none"
    type: Optional[Literal["factura", "rectificativa", "abono"]] = "factura"
    rectifies_id: Optional[str] = None
    project_id: Optional[str] = None
    tags: List[str] = []
    number: Optional[str] = None  # if provided, overrides auto-generated number
    order_number: Optional[str] = ""

class QuoteIn(BaseModel):
    client_id: str; issue_date: str
    valid_until: Optional[str] = None
    items: List[InvoiceItem]
    notes: Optional[str] = ""
    status: Literal["pendiente", "aceptado", "rechazado"] = "pendiente"

class ExpenseIn(BaseModel):
    description: str
    category: str = "General"
    amount: float; iva: float = 21; date: str
    supplier: Optional[str] = ""
    payment_method: Optional[str] = "tarjeta"
    notes: Optional[str] = ""
    receipt_url: Optional[str] = ""
    project_id: Optional[str] = None
    tags: List[str] = []

class PaymentIn(BaseModel):
    amount: float; date: str
    method: Literal["tarjeta", "transferencia", "efectivo", "bizum", "domiciliacion"] = "transferencia"
    notes: Optional[str] = ""

class ProjectIn(BaseModel):
    name: str
    client_id: Optional[str] = None
    description: Optional[str] = ""
    status: Literal["activo", "pausado", "completado"] = "activo"
    hourly_rate: float = 0
    budget: float = 0
    color: str = "#2563EB"

class TimeEntryIn(BaseModel):
    project_id: str
    description: str
    duration_minutes: int
    date: str
    hourly_rate: Optional[float] = None
    billed: bool = False

class AIChatIn(BaseModel):
    message: str
    session_id: Optional[str] = None


# ---------- AUTH ----------
@api.post("/auth/register")
async def register(data: RegisterIn, response: Response):
    email = data.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(400, "El email ya está registrado")
    uid = str(uuid.uuid4())
    await db.users.insert_one({"id": uid, "email": email, "password_hash": hash_password(data.password),
                               "name": data.name, "company": data.company or "", "created_at": now_iso()})
    await ensure_default_profile(uid, data.company or data.name or "Personal")
    access = create_token(uid, email, "access"); refresh = create_token(uid, email, "refresh")
    set_auth_cookies(response, access, refresh)
    return {"id": uid, "email": email, "name": data.name, "company": data.company, "access_token": access}


@api.post("/auth/login")
async def login(data: LoginIn, response: Response):
    email = data.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(data.password, user["password_hash"]):
        raise HTTPException(401, "Credenciales incorrectas")
    await ensure_default_profile(user["id"], user.get("company") or user.get("name") or "Personal")
    access = create_token(user["id"], email, "access"); refresh = create_token(user["id"], email, "refresh")
    set_auth_cookies(response, access, refresh)
    return {"id": user["id"], "email": email, "name": user["name"], "company": user.get("company", ""), "access_token": access}


@api.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    return {"ok": True}


@api.get("/auth/me")
async def me(user=Depends(get_current_user)):
    return user


# ---------- PROFILES ----------
@api.get("/profiles")
async def list_profiles(user=Depends(get_current_user)):
    await ensure_default_profile(user["id"], user.get("company") or user.get("name") or "Personal")
    return await db.profiles.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", 1).to_list(50)


@api.post("/profiles")
async def create_profile(data: ProfileIn, user=Depends(get_current_user)):
    pid = str(uuid.uuid4())
    doc = {"id": pid, "user_id": user["id"], **data.model_dump(),
           "next_number": {s: 1 for s in (data.invoice_series or ["A"])},
           "next_quote": 1, "is_default": False, "created_at": now_iso()}
    await db.profiles.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.put("/profiles/{pid}")
async def update_profile(pid: str, data: ProfileIn, user=Depends(get_current_user)):
    res = await db.profiles.update_one({"id": pid, "user_id": user["id"]}, {"$set": data.model_dump()})
    if res.matched_count == 0:
        raise HTTPException(404, "Perfil no encontrado")
    return {"ok": True}


@api.delete("/profiles/{pid}")
async def delete_profile(pid: str, user=Depends(get_current_user)):
    profiles = await db.profiles.find({"user_id": user["id"]}, {"_id": 0}).to_list(50)
    if len(profiles) <= 1:
        raise HTTPException(400, "No puedes eliminar tu único perfil")
    p = await db.profiles.find_one({"id": pid, "user_id": user["id"]}, {"_id": 0})
    if not p:
        raise HTTPException(404, "Perfil no encontrado")
    if p.get("is_default"):
        # promote oldest other to default
        other = await db.profiles.find_one({"user_id": user["id"], "id": {"$ne": pid}}, {"_id": 0}, sort=[("created_at", 1)])
        if other:
            await db.profiles.update_one({"id": other["id"]}, {"$set": {"is_default": True}})
    await db.profiles.delete_one({"id": pid})
    return {"ok": True}


@api.post("/profiles/{pid}/set-default")
async def set_default_profile(pid: str, user=Depends(get_current_user)):
    p = await db.profiles.find_one({"id": pid, "user_id": user["id"]}, {"_id": 0})
    if not p:
        raise HTTPException(404, "Perfil no encontrado")
    await db.profiles.update_many({"user_id": user["id"]}, {"$set": {"is_default": False}})
    await db.profiles.update_one({"id": pid}, {"$set": {"is_default": True}})
    return {"ok": True}


# ---------- CLIENTS ----------
@api.get("/clients")
async def list_clients(q: Optional[str] = None, ctx=Depends(get_user_context)):
    query = scope(ctx)
    if q:
        query["$or"] = [{"name": {"$regex": q, "$options": "i"}}, {"company": {"$regex": q, "$options": "i"}}, {"nif": {"$regex": q, "$options": "i"}}]
    return await db.clients.find(query, {"_id": 0}).sort("created_at", -1).to_list(2000)


@api.post("/clients")
async def create_client(data: ClientIn, ctx=Depends(get_user_context)):
    doc = {"id": str(uuid.uuid4()), "user_id": ctx["uid"], "profile_id": ctx["pid"], **data.model_dump(), "created_at": now_iso()}
    await db.clients.insert_one(doc)
    doc.pop("_id", None)
    await audit(ctx, "client", doc["id"], doc.get("name", ""), "create")
    return doc


@api.put("/clients/{cid}")
async def update_client(cid: str, data: ClientIn, ctx=Depends(get_user_context)):
    res = await db.clients.update_one(scope(ctx, {"id": cid}), {"$set": data.model_dump()})
    if res.matched_count == 0:
        raise HTTPException(404, "Cliente no encontrado")
    await audit(ctx, "client", cid, data.name, "update")
    return {"ok": True}


@api.delete("/clients/{cid}")
async def delete_client(cid: str, ctx=Depends(get_user_context)):
    cli = await db.clients.find_one(scope(ctx, {"id": cid}), {"_id": 0})
    await db.clients.delete_one(scope(ctx, {"id": cid}))
    if cli:
        await audit(ctx, "client", cid, cli.get("name", ""), "delete")
    return {"ok": True}


@api.get("/clients/morosos")
async def morosos(ctx=Depends(get_user_context)):
    today = datetime.now().date().isoformat()
    invoices = await db.invoices.find(scope(ctx, {"status": {"$ne": "pagada"}, "due_date": {"$lt": today, "$ne": ""}}), {"_id": 0}).to_list(2000)
    by_client = {}
    for i in invoices:
        cid = i.get("client_id")
        if not cid: continue
        if cid not in by_client:
            by_client[cid] = {"client_id": cid, "client_name": i.get("client_name", ""), "total_owed": 0, "count": 0, "oldest": i.get("due_date")}
        owed = i.get("total", 0) - i.get("paid_amount", 0)
        if owed > 0.01:
            by_client[cid]["total_owed"] += owed
            by_client[cid]["count"] += 1
            if i.get("due_date") < by_client[cid]["oldest"]:
                by_client[cid]["oldest"] = i.get("due_date")
    return [v for v in by_client.values() if v["count"] > 0]


# ---------- INVOICES ----------
@api.get("/invoices")
async def list_invoices(status: Optional[str] = None, type: Optional[str] = None, q: Optional[str] = None, ctx=Depends(get_user_context)):
    query = scope(ctx)
    if status: query["status"] = status
    if type: query["type"] = type
    if q: query["$or"] = [{"number": {"$regex": q, "$options": "i"}}, {"client_name": {"$regex": q, "$options": "i"}}]
    items = await db.invoices.find(query, {"_id": 0}).sort("issue_date", -1).to_list(2000)
    today = datetime.now().date().isoformat()
    for inv in items:
        if inv.get("status") == "pendiente" and inv.get("due_date") and inv["due_date"] < today:
            await db.invoices.update_one({"id": inv["id"]}, {"$set": {"status": "vencida"}})
            inv["status"] = "vencida"
    return items


@api.post("/invoices")
async def create_invoice(data: InvoiceIn, ctx=Depends(get_user_context)):
    cli = await db.clients.find_one(scope(ctx, {"id": data.client_id}), {"_id": 0})
    if not cli:
        raise HTTPException(404, "Cliente no encontrado")
    # Allow manual number; otherwise auto-generate. Manual must be unique within profile.
    if data.number:
        number = data.number.strip()
        exists = await db.invoices.find_one(scope(ctx, {"number": number}), {"_id": 0, "id": 1})
        if exists:
            raise HTTPException(400, f"Ya existe una factura con número {number}")
    else:
        number = await next_invoice_number(ctx["pid"], data.series)
    items_d = [i.model_dump() for i in data.items]
    totals = calculate_totals(items_d)
    rectifies_number = ""
    if data.rectifies_id:
        orig = await db.invoices.find_one(scope(ctx, {"id": data.rectifies_id}), {"_id": 0})
        if orig:
            rectifies_number = orig.get("number", "")
    doc = {
        "id": str(uuid.uuid4()), "user_id": ctx["uid"], "profile_id": ctx["pid"],
        "number": number, "series": data.series, "client_id": data.client_id,
        "client_name": cli.get("name", ""), "client_nif": cli.get("nif", ""),
        "client_address": cli.get("address", ""), "client_email": cli.get("email", ""),
        "issue_date": data.issue_date, "due_date": data.due_date or "",
        "items": items_d, "notes": data.notes or "", "status": data.status,
        "recurring": data.recurring, "type": data.type or "factura",
        "rectifies_id": data.rectifies_id or "", "rectifies_number": rectifies_number,
        "project_id": data.project_id or "", "tags": data.tags or [],
        "order_number": data.order_number or "",
        "paid_amount": 0, **totals, "created_at": now_iso(),
    }
    await db.invoices.insert_one(doc)
    doc.pop("_id", None)
    await audit(ctx, "invoice", doc["id"], doc.get("number", ""), "create")
    # VeriFactu: chain hash + QR for non-draft invoices
    if doc.get("status") != "borrador":
        try:
            vf = await compute_verifactu_for_invoice(doc, ctx["profile"])
            await db.invoices.update_one({"id": doc["id"]}, {"$set": vf})
            doc.update(vf)
            await db.verifactu_events.insert_one({
                "id": str(uuid.uuid4()), "user_id": ctx["uid"], "profile_id": ctx["pid"],
                "invoice_id": doc["id"], "invoice_number": doc.get("number", ""),
                "event": "issue", "hash": vf["verifactu_hash"],
                "prev_hash": vf["verifactu_prev_hash"], "qr_payload": vf["verifactu_qr"],
                "created_at": now_iso(),
            })
        except Exception as _e:
            logger.warning(f"verifactu failed: {_e}")
    return doc


@api.get("/invoices/{iid}")
async def get_invoice(iid: str, ctx=Depends(get_user_context)):
    inv = await db.invoices.find_one(scope(ctx, {"id": iid}), {"_id": 0})
    if not inv:
        raise HTTPException(404, "Factura no encontrada")
    return await recompute_invoice_status(inv)


@api.put("/invoices/{iid}")
async def update_invoice(iid: str, data: InvoiceIn, ctx=Depends(get_user_context)):
    items_d = [i.model_dump() for i in data.items]
    totals = calculate_totals(items_d)
    update = {
        "client_id": data.client_id, "issue_date": data.issue_date, "due_date": data.due_date or "",
        "items": items_d, "notes": data.notes or "", "status": data.status,
        "recurring": data.recurring, "type": data.type or "factura",
        "rectifies_id": data.rectifies_id or "", "project_id": data.project_id or "",
        "tags": data.tags or [], "order_number": data.order_number or "", **totals,
    }
    # Allow manual number edit, validate uniqueness if changed
    if data.number:
        existing = await db.invoices.find_one(scope(ctx, {"id": iid}), {"_id": 0, "number": 1})
        new_num = data.number.strip()
        if existing and existing.get("number") != new_num:
            dup = await db.invoices.find_one(scope(ctx, {"number": new_num, "id": {"$ne": iid}}), {"_id": 0, "id": 1})
            if dup:
                raise HTTPException(400, f"Ya existe una factura con número {new_num}")
            update["number"] = new_num
            update["series"] = data.series
    cli = await db.clients.find_one(scope(ctx, {"id": data.client_id}), {"_id": 0})
    if cli:
        update["client_name"] = cli.get("name", "")
        update["client_nif"] = cli.get("nif", "")
        update["client_address"] = cli.get("address", "")
        update["client_email"] = cli.get("email", "")
    res = await db.invoices.update_one(scope(ctx, {"id": iid}), {"$set": update})
    if res.matched_count == 0:
        raise HTTPException(404, "Factura no encontrada")
    inv = await db.invoices.find_one(scope(ctx, {"id": iid}), {"_id": 0, "number": 1})
    await audit(ctx, "invoice", iid, (inv or {}).get("number", ""), "update", {"status": data.status, "total": totals.get("total", 0)})
    return {"ok": True}


@api.delete("/invoices/{iid}")
async def delete_invoice(iid: str, ctx=Depends(get_user_context)):
    inv = await db.invoices.find_one(scope(ctx, {"id": iid}), {"_id": 0, "number": 1})
    await db.invoices.delete_one(scope(ctx, {"id": iid}))
    await db.payments.delete_many(scope(ctx, {"invoice_id": iid}))
    if inv:
        await audit(ctx, "invoice", iid, inv.get("number", ""), "delete")
    return {"ok": True}


@api.post("/invoices/{iid}/duplicate")
async def duplicate_invoice(iid: str, ctx=Depends(get_user_context)):
    inv = await db.invoices.find_one(scope(ctx, {"id": iid}), {"_id": 0})
    if not inv:
        raise HTTPException(404, "Factura no encontrada")
    s = inv.get("series", "A")
    number = await next_invoice_number(ctx["pid"], s)
    new = {**inv, "id": str(uuid.uuid4()), "number": number, "status": "pendiente",
           "paid_amount": 0, "issue_date": datetime.now().date().isoformat(),
           "rectifies_id": "", "rectifies_number": "", "type": "factura",
           "created_at": now_iso()}
    await db.invoices.insert_one(new)
    new.pop("_id", None); return new


@api.post("/invoices/{iid}/rectify")
async def rectify_invoice(iid: str, ctx=Depends(get_user_context)):
    orig = await db.invoices.find_one(scope(ctx, {"id": iid}), {"_id": 0})
    if not orig:
        raise HTTPException(404, "Factura no encontrada")
    series = "R"
    number = await next_invoice_number(ctx["pid"], series)
    items = [{**it, "quantity": -abs(it.get("quantity", 0))} for it in orig.get("items", [])]
    totals = calculate_totals(items)
    new = {
        "id": str(uuid.uuid4()), "user_id": ctx["uid"], "profile_id": ctx["pid"],
        "number": number, "series": series,
        "client_id": orig["client_id"], "client_name": orig.get("client_name", ""),
        "client_nif": orig.get("client_nif", ""), "client_address": orig.get("client_address", ""),
        "client_email": orig.get("client_email", ""),
        "issue_date": datetime.now().date().isoformat(), "due_date": "",
        "items": items, "notes": f"Factura rectificativa de {orig.get('number', '')}",
        "status": "pendiente", "recurring": "none", "type": "rectificativa",
        "rectifies_id": iid, "rectifies_number": orig.get("number", ""),
        "project_id": orig.get("project_id", ""), "tags": orig.get("tags", []),
        "paid_amount": 0, **totals, "created_at": now_iso(),
    }
    await db.invoices.insert_one(new)
    new.pop("_id", None); return new


@api.get("/invoices/{iid}/pdf")
async def invoice_pdf(iid: str, show_qr: bool = True, ctx=Depends(get_user_context)):
    inv = await db.invoices.find_one(scope(ctx, {"id": iid}), {"_id": 0})
    if not inv:
        raise HTTPException(404, "Factura no encontrada")
    buf = generate_invoice_pdf(inv, ctx["profile"], show_qr=show_qr)
    return StreamingResponse(buf, media_type="application/pdf",
                             headers={"Content-Disposition": f"attachment; filename=factura-{inv['number']}.pdf"})


def generate_invoice_pdf(inv: dict, profile: dict, title: str = None, show_qr: bool = True) -> io.BytesIO:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.lib import colors
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=20 * mm, rightMargin=20 * mm, topMargin=18 * mm, bottomMargin=18 * mm)
    styles = getSampleStyleSheet()
    h = ParagraphStyle("h", parent=styles["Heading1"], textColor=colors.HexColor("#0F172A"), fontSize=22)
    sub = ParagraphStyle("sub", parent=styles["Normal"], textColor=colors.HexColor("#64748B"), fontSize=10)
    body = ParagraphStyle("body", parent=styles["Normal"], fontSize=10, leading=14)
    elements = []
    label_map = {"factura": "FACTURA", "rectificativa": "FACTURA RECTIFICATIVA", "abono": "ABONO", "presupuesto": "PRESUPUESTO"}
    doc_label = title or label_map.get(inv.get("type", "factura"), "FACTURA")
    elements.append(Paragraph(f"{doc_label} <font color='#2563EB'>{inv['number']}</font>", h))
    sub_line = f"Fecha: {inv['issue_date']}"
    if inv.get("due_date"): sub_line += f" &nbsp; · &nbsp; Vencimiento: {inv['due_date']}"
    if inv.get("order_number"): sub_line += f" &nbsp; · &nbsp; Nº Pedido: {inv['order_number']}"
    if inv.get("rectifies_number"): sub_line += f" &nbsp; · &nbsp; Rectifica: {inv['rectifies_number']}"
    if inv.get("valid_until"): sub_line += f" &nbsp; · &nbsp; Válido hasta: {inv['valid_until']}"
    elements.append(Paragraph(sub_line, sub))
    elements.append(Spacer(1, 14))
    # Company logo (top right)
    logo_url = (profile or {}).get("logo_url", "")
    if logo_url:
        try:
            from reportlab.platypus import Image
            logo_bytes = None
            if logo_url.startswith("data:image"):
                _, b64 = logo_url.split(",", 1)
                logo_bytes = base64.b64decode(b64)
            elif logo_url.startswith("http"):
                import urllib.request
                with urllib.request.urlopen(logo_url, timeout=4) as r:
                    logo_bytes = r.read()
            if logo_bytes:
                logo_img = Image(io.BytesIO(logo_bytes), width=36 * mm, height=22 * mm, kind="proportional")
                logo_img.hAlign = "RIGHT"
                elements.append(logo_img)
                elements.append(Spacer(1, 6))
        except Exception as _e:
            logger.warning(f"logo embed failed: {_e}")
    emisor = f"<b>{profile.get('fiscal_name', '')}</b><br/>NIF: {profile.get('nif', '')}<br/>{profile.get('address', '')}<br/>{profile.get('email', '')}"
    receptor = f"<b>{inv.get('client_name', '')}</b><br/>NIF: {inv.get('client_nif', '')}<br/>{inv.get('client_address', '')}"
    info_tbl = Table([[Paragraph("EMISOR", sub), Paragraph("CLIENTE", sub)], [Paragraph(emisor, body), Paragraph(receptor, body)]], colWidths=[85 * mm, 85 * mm])
    info_tbl.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
    elements.append(info_tbl)
    elements.append(Spacer(1, 16))
    rows = [["Descripción", "Cant.", "Precio", "IVA%", "IRPF%", "Total"]]
    for it in inv["items"]:
        line = (it.get("quantity", 0) or 0) * (it.get("price", 0) or 0) * (1 - (it.get("discount", 0) or 0) / 100)
        rows.append([it["description"], f"{it['quantity']}", f"{it['price']:.2f} €", f"{it.get('iva', 0):.0f}%", f"{it.get('irpf', 0):.0f}%", f"{line:.2f} €"])
    items_tbl = Table(rows, colWidths=[70 * mm, 18 * mm, 24 * mm, 16 * mm, 16 * mm, 26 * mm])
    items_tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0F172A")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8FAFC")]),
    ]))
    elements.append(items_tbl); elements.append(Spacer(1, 16))
    totals = [["Subtotal", f"{inv['subtotal']:.2f} €"], ["IVA", f"{inv['iva_total']:.2f} €"],
              ["IRPF", f"-{inv['irpf_total']:.2f} €"], ["TOTAL", f"{inv['total']:.2f} €"]]
    if inv.get("paid_amount"):
        totals.append(["Pagado", f"{inv['paid_amount']:.2f} €"])
        totals.append(["Pendiente", f"{inv['total'] - inv['paid_amount']:.2f} €"])
    t_tbl = Table(totals, colWidths=[40 * mm, 30 * mm], hAlign="RIGHT")
    t_tbl.setStyle(TableStyle([
        ("FONTNAME", (0, 3), (-1, 3), "Helvetica-Bold"),
        ("FONTSIZE", (0, 3), (-1, 3), 12),
        ("TEXTCOLOR", (0, 3), (-1, 3), colors.HexColor("#2563EB")),
        ("LINEABOVE", (0, 3), (-1, 3), 0.5, colors.HexColor("#E2E8F0")),
    ]))
    elements.append(t_tbl)
    if inv.get("notes"):
        elements.append(Spacer(1, 16))
        elements.append(Paragraph(f"<b>Observaciones:</b> {inv['notes']}", body))
    # Bank account (from profile)
    iban = (profile or {}).get("bank_iban", "")
    bank_name = (profile or {}).get("bank_name", "")
    if iban:
        elements.append(Spacer(1, 12))
        bank_label = f"<b>Datos bancarios:</b> IBAN {iban}"
        if bank_name:
            bank_label += f" · {bank_name}"
        elements.append(Paragraph(bank_label, body))
    if profile.get("signature"):
        elements.append(Spacer(1, 16))
        elements.append(Paragraph(f"<i>{profile['signature']}</i>", body))
    # Verifactu QR (only if show_qr and present)
    if show_qr and inv.get("verifactu_qr"):
        from reportlab.platypus import Image
        try:
            qr_b64 = qr_png_base64(inv["verifactu_qr"])
            qr_bytes = base64.b64decode(qr_b64)
            qr_io = io.BytesIO(qr_bytes)
            elements.append(Spacer(1, 12))
            qr_img = Image(qr_io, width=24 * mm, height=24 * mm)
            qr_tbl = Table([[qr_img, Paragraph(f"<b>Verifactu</b><br/>Hash: {inv['verifactu_hash'][:16]}...<br/>UUID: {inv['verifactu_uuid'][:8]}...", sub)]], colWidths=[28 * mm, 100 * mm])
            qr_tbl.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE")]))
            elements.append(qr_tbl)
        except Exception as e:
            logger.error(f"QR embed failed: {e}")
    elements.append(Spacer(1, 24))
    elements.append(Paragraph("Documento generado por FakturaFlow · fakturaflow.es", sub))
    doc.build(elements)
    buf.seek(0); return buf


# ---------- PAYMENTS ----------
@api.get("/invoices/{iid}/payments")
async def list_payments(iid: str, ctx=Depends(get_user_context)):
    return await db.payments.find(scope(ctx, {"invoice_id": iid}), {"_id": 0}).sort("date", -1).to_list(100)


@api.post("/invoices/{iid}/payments")
async def add_payment(iid: str, data: PaymentIn, ctx=Depends(get_user_context)):
    inv = await db.invoices.find_one(scope(ctx, {"id": iid}), {"_id": 0})
    if not inv:
        raise HTTPException(404, "Factura no encontrada")
    pay = {"id": str(uuid.uuid4()), "invoice_id": iid, "user_id": ctx["uid"], "profile_id": ctx["pid"],
           **data.model_dump(), "created_at": now_iso()}
    await db.payments.insert_one(pay)
    new_paid = round(inv.get("paid_amount", 0) + data.amount, 2)
    await db.invoices.update_one({"id": iid}, {"$set": {"paid_amount": new_paid}})
    inv["paid_amount"] = new_paid
    await recompute_invoice_status(inv)
    pay.pop("_id", None); return pay


@api.delete("/payments/{pid}")
async def delete_payment(pid: str, ctx=Depends(get_user_context)):
    pay = await db.payments.find_one(scope(ctx, {"id": pid}), {"_id": 0})
    if not pay:
        raise HTTPException(404, "Pago no encontrado")
    await db.payments.delete_one({"id": pid})
    inv = await db.invoices.find_one(scope(ctx, {"id": pay["invoice_id"]}), {"_id": 0})
    if inv:
        new_paid = max(0, round(inv.get("paid_amount", 0) - pay["amount"], 2))
        await db.invoices.update_one({"id": pay["invoice_id"]}, {"$set": {"paid_amount": new_paid}})
        inv["paid_amount"] = new_paid
        await recompute_invoice_status(inv)
    return {"ok": True}


# ---------- QUOTES ----------
@api.get("/quotes")
async def list_quotes(status: Optional[str] = None, ctx=Depends(get_user_context)):
    query = scope(ctx)
    if status: query["status"] = status
    return await db.quotes.find(query, {"_id": 0}).sort("issue_date", -1).to_list(2000)


@api.post("/quotes")
async def create_quote(data: QuoteIn, ctx=Depends(get_user_context)):
    cli = await db.clients.find_one(scope(ctx, {"id": data.client_id}), {"_id": 0})
    if not cli:
        raise HTTPException(404, "Cliente no encontrado")
    number = await next_quote_number(ctx["pid"])
    items_d = [i.model_dump() for i in data.items]
    totals = calculate_totals(items_d)
    doc = {
        "id": str(uuid.uuid4()), "user_id": ctx["uid"], "profile_id": ctx["pid"],
        "number": number, "client_id": data.client_id,
        "client_name": cli.get("name", ""), "client_nif": cli.get("nif", ""),
        "client_address": cli.get("address", ""), "client_email": cli.get("email", ""),
        "issue_date": data.issue_date, "valid_until": data.valid_until or "",
        "items": items_d, "notes": data.notes or "", "status": data.status,
        "type": "presupuesto", "converted_invoice_id": "",
        **totals, "created_at": now_iso(),
    }
    await db.quotes.insert_one(doc)
    doc.pop("_id", None); return doc


@api.get("/quotes/{qid}")
async def get_quote(qid: str, ctx=Depends(get_user_context)):
    q = await db.quotes.find_one(scope(ctx, {"id": qid}), {"_id": 0})
    if not q:
        raise HTTPException(404, "Presupuesto no encontrado")
    return q


@api.put("/quotes/{qid}")
async def update_quote(qid: str, data: QuoteIn, ctx=Depends(get_user_context)):
    items_d = [i.model_dump() for i in data.items]
    totals = calculate_totals(items_d)
    update = {"client_id": data.client_id, "issue_date": data.issue_date,
              "valid_until": data.valid_until or "", "items": items_d,
              "notes": data.notes or "", "status": data.status, **totals}
    cli = await db.clients.find_one(scope(ctx, {"id": data.client_id}), {"_id": 0})
    if cli:
        update.update({"client_name": cli.get("name", ""), "client_nif": cli.get("nif", ""),
                       "client_address": cli.get("address", ""), "client_email": cli.get("email", "")})
    res = await db.quotes.update_one(scope(ctx, {"id": qid}), {"$set": update})
    if res.matched_count == 0:
        raise HTTPException(404, "Presupuesto no encontrado")
    return {"ok": True}


@api.delete("/quotes/{qid}")
async def delete_quote(qid: str, ctx=Depends(get_user_context)):
    await db.quotes.delete_one(scope(ctx, {"id": qid}))
    return {"ok": True}


@api.post("/quotes/{qid}/convert")
async def convert_quote(qid: str, ctx=Depends(get_user_context)):
    q = await db.quotes.find_one(scope(ctx, {"id": qid}), {"_id": 0})
    if not q:
        raise HTTPException(404, "Presupuesto no encontrado")
    if q.get("converted_invoice_id"):
        raise HTTPException(400, "Este presupuesto ya fue convertido")
    series = (ctx["profile"].get("invoice_series") or ["A"])[0]
    number = await next_invoice_number(ctx["pid"], series)
    inv = {
        "id": str(uuid.uuid4()), "user_id": ctx["uid"], "profile_id": ctx["pid"],
        "number": number, "series": series, "client_id": q["client_id"],
        "client_name": q.get("client_name", ""), "client_nif": q.get("client_nif", ""),
        "client_address": q.get("client_address", ""), "client_email": q.get("client_email", ""),
        "issue_date": datetime.now().date().isoformat(), "due_date": "",
        "items": q["items"], "notes": f"Generada desde presupuesto {q['number']}",
        "status": "pendiente", "recurring": "none", "type": "factura",
        "rectifies_id": "", "rectifies_number": "", "tags": [], "project_id": "",
        "paid_amount": 0, "subtotal": q["subtotal"], "iva_total": q["iva_total"],
        "irpf_total": q["irpf_total"], "total": q["total"], "created_at": now_iso(),
    }
    await db.invoices.insert_one(inv)
    await db.quotes.update_one({"id": qid}, {"$set": {"status": "aceptado", "converted_invoice_id": inv["id"]}})
    inv.pop("_id", None); return inv


@api.get("/quotes/{qid}/pdf")
async def quote_pdf(qid: str, ctx=Depends(get_user_context)):
    q = await db.quotes.find_one(scope(ctx, {"id": qid}), {"_id": 0})
    if not q:
        raise HTTPException(404, "Presupuesto no encontrado")
    buf = generate_invoice_pdf(q, ctx["profile"], title="PRESUPUESTO")
    return StreamingResponse(buf, media_type="application/pdf",
                             headers={"Content-Disposition": f"attachment; filename=presupuesto-{q['number']}.pdf"})


# ---------- EXPENSES ----------
@api.get("/expenses")
async def list_expenses(q: Optional[str] = None, category: Optional[str] = None, ctx=Depends(get_user_context)):
    query = scope(ctx)
    if category: query["category"] = category
    if q:
        query["$or"] = [{"description": {"$regex": q, "$options": "i"}}, {"supplier": {"$regex": q, "$options": "i"}}, {"category": {"$regex": q, "$options": "i"}}]
    return await db.expenses.find(query, {"_id": 0}).sort("date", -1).to_list(2000)


@api.post("/expenses")
async def create_expense(data: ExpenseIn, ctx=Depends(get_user_context)):
    doc = {"id": str(uuid.uuid4()), "user_id": ctx["uid"], "profile_id": ctx["pid"], **data.model_dump(), "created_at": now_iso()}
    await db.expenses.insert_one(doc)
    doc.pop("_id", None); return doc


@api.put("/expenses/{eid}")
async def update_expense(eid: str, data: ExpenseIn, ctx=Depends(get_user_context)):
    res = await db.expenses.update_one(scope(ctx, {"id": eid}), {"$set": data.model_dump()})
    if res.matched_count == 0:
        raise HTTPException(404, "Gasto no encontrado")
    return {"ok": True}


@api.delete("/expenses/{eid}")
async def delete_expense(eid: str, ctx=Depends(get_user_context)):
    await db.expenses.delete_one(scope(ctx, {"id": eid}))
    return {"ok": True}


# ---------- TAGS ----------
@api.get("/tags")
async def list_tags(entity: Literal["client", "invoice", "expense"], ctx=Depends(get_user_context)):
    coll = {"client": "clients", "invoice": "invoices", "expense": "expenses"}[entity]
    pipeline = [
        {"$match": scope(ctx)},
        {"$unwind": {"path": "$tags", "preserveNullAndEmptyArrays": False}},
        {"$group": {"_id": "$tags", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
    ]
    res = await db[coll].aggregate(pipeline).to_list(200)
    return [{"tag": r["_id"], "count": r["count"]} for r in res if r["_id"]]


# ---------- PROJECTS ----------
@api.get("/projects")
async def list_projects(ctx=Depends(get_user_context)):
    projects = await db.projects.find(scope(ctx), {"_id": 0}).sort("created_at", -1).to_list(500)
    # Aggregate stats
    for p in projects:
        invs = await db.invoices.find(scope(ctx, {"project_id": p["id"]}), {"_id": 0}).to_list(500)
        exps = await db.expenses.find(scope(ctx, {"project_id": p["id"]}), {"_id": 0}).to_list(500)
        times = await db.time_entries.find(scope(ctx, {"project_id": p["id"]}), {"_id": 0}).to_list(2000)
        p["stats"] = {
            "invoiced": round(sum(i.get("subtotal", 0) for i in invs), 2),
            "expenses": round(sum(e.get("amount", 0) for e in exps), 2),
            "hours": round(sum(t.get("duration_minutes", 0) for t in times) / 60, 2),
            "invoices_count": len(invs),
        }
    return projects


@api.post("/projects")
async def create_project(data: ProjectIn, ctx=Depends(get_user_context)):
    doc = {"id": str(uuid.uuid4()), "user_id": ctx["uid"], "profile_id": ctx["pid"],
           **data.model_dump(), "created_at": now_iso()}
    await db.projects.insert_one(doc)
    doc.pop("_id", None); return doc


@api.get("/projects/{pid}")
async def get_project(pid: str, ctx=Depends(get_user_context)):
    p = await db.projects.find_one(scope(ctx, {"id": pid}), {"_id": 0})
    if not p:
        raise HTTPException(404, "Proyecto no encontrado")
    p["invoices"] = await db.invoices.find(scope(ctx, {"project_id": pid}), {"_id": 0}).to_list(500)
    p["expenses"] = await db.expenses.find(scope(ctx, {"project_id": pid}), {"_id": 0}).to_list(500)
    p["time_entries"] = await db.time_entries.find(scope(ctx, {"project_id": pid}), {"_id": 0}).sort("date", -1).to_list(2000)
    return p


@api.put("/projects/{pid}")
async def update_project(pid: str, data: ProjectIn, ctx=Depends(get_user_context)):
    res = await db.projects.update_one(scope(ctx, {"id": pid}), {"$set": data.model_dump()})
    if res.matched_count == 0:
        raise HTTPException(404, "Proyecto no encontrado")
    return {"ok": True}


@api.delete("/projects/{pid}")
async def delete_project(pid: str, ctx=Depends(get_user_context)):
    await db.projects.delete_one(scope(ctx, {"id": pid}))
    # unlink
    await db.invoices.update_many(scope(ctx, {"project_id": pid}), {"$set": {"project_id": ""}})
    await db.expenses.update_many(scope(ctx, {"project_id": pid}), {"$set": {"project_id": ""}})
    await db.time_entries.delete_many(scope(ctx, {"project_id": pid}))
    return {"ok": True}


# ---------- TIME ENTRIES ----------
@api.get("/time-entries")
async def list_time_entries(project_id: Optional[str] = None, billed: Optional[bool] = None, ctx=Depends(get_user_context)):
    query = scope(ctx)
    if project_id: query["project_id"] = project_id
    if billed is not None: query["billed"] = billed
    return await db.time_entries.find(query, {"_id": 0}).sort("date", -1).to_list(2000)


@api.post("/time-entries")
async def create_time_entry(data: TimeEntryIn, ctx=Depends(get_user_context)):
    proj = await db.projects.find_one(scope(ctx, {"id": data.project_id}), {"_id": 0})
    if not proj:
        raise HTTPException(404, "Proyecto no encontrado")
    rate = data.hourly_rate if data.hourly_rate is not None else proj.get("hourly_rate", 0)
    doc = {"id": str(uuid.uuid4()), "user_id": ctx["uid"], "profile_id": ctx["pid"],
           **data.model_dump(), "hourly_rate": rate,
           "amount": round((data.duration_minutes / 60) * rate, 2),
           "project_name": proj.get("name", ""), "created_at": now_iso()}
    await db.time_entries.insert_one(doc)
    doc.pop("_id", None); return doc


@api.put("/time-entries/{tid}")
async def update_time_entry(tid: str, data: TimeEntryIn, ctx=Depends(get_user_context)):
    proj = await db.projects.find_one(scope(ctx, {"id": data.project_id}), {"_id": 0})
    rate = data.hourly_rate if data.hourly_rate is not None else (proj or {}).get("hourly_rate", 0)
    update = {**data.model_dump(), "hourly_rate": rate,
              "amount": round((data.duration_minutes / 60) * rate, 2),
              "project_name": (proj or {}).get("name", "")}
    res = await db.time_entries.update_one(scope(ctx, {"id": tid}), {"$set": update})
    if res.matched_count == 0:
        raise HTTPException(404, "Entrada no encontrada")
    return {"ok": True}


@api.delete("/time-entries/{tid}")
async def delete_time_entry(tid: str, ctx=Depends(get_user_context)):
    await db.time_entries.delete_one(scope(ctx, {"id": tid}))
    return {"ok": True}


class ConvertTimeIn(BaseModel):
    time_entry_ids: List[str]
    client_id: str
    series: str = "A"
    iva: float = 21
    irpf: float = 0


@api.post("/time-entries/convert-to-invoice")
async def convert_time_to_invoice(data: ConvertTimeIn, ctx=Depends(get_user_context)):
    cli = await db.clients.find_one(scope(ctx, {"id": data.client_id}), {"_id": 0})
    if not cli:
        raise HTTPException(404, "Cliente no encontrado")
    entries = await db.time_entries.find(scope(ctx, {"id": {"$in": data.time_entry_ids}}), {"_id": 0}).to_list(2000)
    if not entries:
        raise HTTPException(400, "Sin entradas seleccionadas")
    # Group by project for cleaner items
    items = []
    for e in entries:
        hours = round(e["duration_minutes"] / 60, 2)
        items.append({
            "description": f"{e.get('project_name', '')} · {e['description']} ({hours}h)",
            "quantity": hours, "price": e.get("hourly_rate", 0),
            "iva": data.iva, "irpf": data.irpf, "discount": 0,
        })
    totals = calculate_totals(items)
    number = await next_invoice_number(ctx["pid"], data.series)
    inv = {
        "id": str(uuid.uuid4()), "user_id": ctx["uid"], "profile_id": ctx["pid"],
        "number": number, "series": data.series, "client_id": data.client_id,
        "client_name": cli.get("name", ""), "client_nif": cli.get("nif", ""),
        "client_address": cli.get("address", ""), "client_email": cli.get("email", ""),
        "issue_date": datetime.now().date().isoformat(), "due_date": "",
        "items": items, "notes": f"Facturación de {len(entries)} entradas de tiempo",
        "status": "pendiente", "recurring": "none", "type": "factura",
        "rectifies_id": "", "rectifies_number": "", "tags": ["horas"],
        "project_id": entries[0].get("project_id", ""), "paid_amount": 0,
        **totals, "created_at": now_iso(),
    }
    await db.invoices.insert_one(inv)
    await db.time_entries.update_many({"id": {"$in": data.time_entry_ids}}, {"$set": {"billed": True, "invoice_id": inv["id"]}})
    inv.pop("_id", None); return inv


# ---------- DOCUMENTS (base64 in mongo) ----------
MAX_DOC_BYTES = 4 * 1024 * 1024  # 4MB

@api.post("/documents")
async def upload_document(
    file: UploadFile = File(...),
    entity_type: str = Form(...),
    entity_id: str = Form(...),
    ctx=Depends(get_user_context),
):
    if entity_type not in ("client", "invoice", "expense", "quote", "project"):
        raise HTTPException(400, "entity_type inválido")
    raw = await file.read()
    if len(raw) > MAX_DOC_BYTES:
        raise HTTPException(400, f"Archivo demasiado grande (máx {MAX_DOC_BYTES // 1024 // 1024}MB)")
    doc = {
        "id": str(uuid.uuid4()), "user_id": ctx["uid"], "profile_id": ctx["pid"],
        "entity_type": entity_type, "entity_id": entity_id,
        "filename": file.filename or "documento", "content_type": file.content_type or "application/octet-stream",
        "size": len(raw), "data_b64": base64.b64encode(raw).decode(),
        "created_at": now_iso(),
    }
    await db.documents.insert_one(doc)
    return {k: v for k, v in doc.items() if k not in ("_id", "data_b64")}


@api.get("/documents")
async def list_documents(entity_type: str, entity_id: str, ctx=Depends(get_user_context)):
    docs = await db.documents.find(scope(ctx, {"entity_type": entity_type, "entity_id": entity_id}), {"_id": 0, "data_b64": 0}).sort("created_at", -1).to_list(200)
    return docs


@api.get("/documents/{did}")
async def download_document(did: str, ctx=Depends(get_user_context)):
    d = await db.documents.find_one(scope(ctx, {"id": did}), {"_id": 0})
    if not d:
        raise HTTPException(404, "Documento no encontrado")
    raw = base64.b64decode(d["data_b64"])
    return StreamingResponse(io.BytesIO(raw), media_type=d.get("content_type", "application/octet-stream"),
                             headers={"Content-Disposition": f"attachment; filename={d.get('filename', 'documento')}"})


@api.delete("/documents/{did}")
async def delete_document(did: str, ctx=Depends(get_user_context)):
    await db.documents.delete_one(scope(ctx, {"id": did}))
    return {"ok": True}


# ---------- AI / GROQ ----------
def pdf_first_page_to_jpeg_bytes(pdf_bytes: bytes) -> bytes:
    pdf = pdfium.PdfDocument(pdf_bytes)
    page = pdf[0]
    pil_image = page.render(scale=2.0).to_pil()
    out = io.BytesIO()
    pil_image.convert("RGB").save(out, format="JPEG", quality=85)
    out.seek(0); return out.read()


@api.post("/ai/ocr-receipt")
async def ocr_receipt(file: UploadFile = File(...), ctx=Depends(get_user_context)):
    if not groq_client:
        raise HTTPException(500, "Groq API no configurada")
    raw = await file.read()
    if len(raw) > 10 * 1024 * 1024:
        raise HTTPException(400, "Archivo demasiado grande (máx 10MB)")
    mime = (file.content_type or "image/jpeg").lower()
    fname = (file.filename or "").lower()
    is_pdf = "pdf" in mime or fname.endswith(".pdf")
    if is_pdf:
        try:
            raw = pdf_first_page_to_jpeg_bytes(raw); mime = "image/jpeg"
        except Exception as e:
            logger.error(f"PDF convert failed: {e}")
            raise HTTPException(400, "No se pudo procesar el PDF.")
    elif not any(t in mime for t in ["png", "jpeg", "jpg", "webp"]):
        raise HTTPException(400, "Formato no soportado.")
    b64 = base64.b64encode(raw).decode()
    prompt = (
        "Eres un asistente fiscal español. Analiza este ticket o factura. "
        "Devuelve SOLO un JSON válido con: amount (número), iva (porcentaje 21/10/4/0), "
        "merchant, date (YYYY-MM-DD), category (una de: 'Material oficina','Software','Restauración','Transporte','Suministros','Marketing','Servicios profesionales','Otros'), "
        "description (resumen breve). Si no detectas algo, usa null."
    )
    try:
        resp = groq_client.chat.completions.create(
            model=GROQ_VISION_MODEL,
            messages=[{"role": "user", "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}},
            ]}],
            response_format={"type": "json_object"}, temperature=0.1, max_tokens=512,
        )
        return json.loads(resp.choices[0].message.content)
    except Exception as e:
        logger.error(f"OCR error: {e}")
        raise HTTPException(500, f"Error: {str(e)}")


@api.post("/ai/import-invoice")
async def ai_import_invoice(
    file: UploadFile = File(...),
    target: str = Form("invoice"),  # "invoice" or "quote"
    save: bool = Form(False),
    ctx=Depends(get_user_context),
):
    """Read a PDF/image of an invoice or quote, extract structured data with Groq.
    If save=True, create the document in DB. Otherwise return the extracted preview
    so the user can review and confirm before saving."""
    if not groq_client:
        raise HTTPException(500, "Groq API no configurada")
    if target not in ("invoice", "quote"):
        raise HTTPException(400, "target debe ser 'invoice' o 'quote'")
    raw = await file.read()
    if len(raw) > 10 * 1024 * 1024:
        raise HTTPException(400, "Archivo demasiado grande (máx 10MB)")
    mime = (file.content_type or "image/jpeg").lower()
    fname = (file.filename or "").lower()
    is_pdf = "pdf" in mime or fname.endswith(".pdf")
    if is_pdf:
        try:
            raw = pdf_first_page_to_jpeg_bytes(raw); mime = "image/jpeg"
        except Exception as e:
            logger.error(f"PDF convert failed: {e}")
            raise HTTPException(400, "No se pudo procesar el PDF.")
    elif not any(t in mime for t in ["png", "jpeg", "jpg", "webp"]):
        raise HTTPException(400, "Formato no soportado (PNG, JPG o PDF).")
    b64 = base64.b64encode(raw).decode()
    label = "factura" if target == "invoice" else "presupuesto"
    prompt = (
        f"Eres un asistente fiscal español. Analiza esta imagen/PDF de una {label} y extrae sus datos. "
        "Devuelve SOLO un JSON válido con esta estructura exacta:\n"
        "{\n"
        '  "number": "<numero del documento, ej A-2026-0042>",\n'
        '  "series": "<serie/prefijo, ej A o FACT>",\n'
        '  "issue_date": "<YYYY-MM-DD>",\n'
        '  "due_date": "<YYYY-MM-DD o null>",\n'
        '  "order_number": "<numero de pedido si aparece, o null>",\n'
        '  "client_name": "<nombre del cliente/destinatario>",\n'
        '  "client_nif": "<NIF/CIF del cliente o null>",\n'
        '  "client_address": "<direccion o null>",\n'
        '  "client_email": "<email o null>",\n'
        '  "notes": "<observaciones o forma de pago si aparecen, o null>",\n'
        '  "items": [\n'
        '    {"description": "<concepto>", "quantity": <num>, "price": <num sin IVA>, "iva": <21|10|4|0>, "irpf": <num o 0>, "discount": <num o 0>}\n'
        "  ]\n"
        "}\n"
        "Reglas: 'price' es el precio unitario SIN IVA. 'iva' es el porcentaje (21,10,4,0). "
        "'quantity' nunca null (1 por defecto). Si hay varios conceptos, ponlos todos en 'items'. "
        "Si no encuentras un campo, usa null (excepto items y quantity)."
    )
    try:
        resp = groq_client.chat.completions.create(
            model=GROQ_VISION_MODEL,
            messages=[{"role": "user", "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}},
            ]}],
            response_format={"type": "json_object"}, temperature=0.1, max_tokens=2048,
        )
        data = json.loads(resp.choices[0].message.content)
    except Exception as e:
        logger.error(f"AI import error: {e}")
        raise HTTPException(500, f"Error analizando documento: {str(e)}")

    # Normalize items
    items = data.get("items") or []
    if not isinstance(items, list):
        items = []
    norm_items = []
    for it in items:
        if not isinstance(it, dict):
            continue
        norm_items.append({
            "description": str(it.get("description") or "Importado").strip()[:500],
            "quantity": float(it.get("quantity") or 1),
            "price": float(it.get("price") or 0),
            "iva": float(it.get("iva") or 21),
            "irpf": float(it.get("irpf") or 0),
            "discount": float(it.get("discount") or 0),
        })
    if not norm_items:
        norm_items = [{"description": "Concepto importado", "quantity": 1, "price": 0, "iva": 21, "irpf": 0, "discount": 0}]

    preview = {
        "number": (data.get("number") or "").strip(),
        "series": (data.get("series") or "A").strip(),
        "issue_date": (data.get("issue_date") or datetime.now().date().isoformat()),
        "due_date": data.get("due_date") or "",
        "order_number": (data.get("order_number") or "") if target == "invoice" else "",
        "client_name": (data.get("client_name") or "").strip(),
        "client_nif": (data.get("client_nif") or "").strip(),
        "client_address": (data.get("client_address") or "").strip(),
        "client_email": (data.get("client_email") or "").strip(),
        "notes": (data.get("notes") or "").strip(),
        "items": norm_items,
    }

    if not save:
        return {"saved": False, "preview": preview}

    # Resolve or create client
    cid = ""
    if preview["client_nif"]:
        existing = await db.clients.find_one(scope(ctx, {"nif": preview["client_nif"]}), {"_id": 0})
        if existing:
            cid = existing["id"]
    if not cid and preview["client_name"]:
        existing = await db.clients.find_one(scope(ctx, {"name": preview["client_name"]}), {"_id": 0})
        if existing:
            cid = existing["id"]
    if not cid:
        cid = str(uuid.uuid4())
        await db.clients.insert_one({
            "id": cid, "user_id": ctx["uid"], "profile_id": ctx["pid"],
            "name": preview["client_name"] or "Cliente importado",
            "company": "", "nif": preview["client_nif"],
            "address": preview["client_address"], "email": preview["client_email"],
            "phone": "", "notes": "Importado por IA", "tags": [],
            "created_at": now_iso(),
        })

    totals = calculate_totals(preview["items"])
    if target == "invoice":
        # Use provided number if any, else auto
        number = preview["number"] or await next_invoice_number(ctx["pid"], preview["series"])
        # Avoid duplicates
        if preview["number"]:
            dup = await db.invoices.find_one(scope(ctx, {"number": number}), {"_id": 0, "id": 1})
            if dup:
                number = await next_invoice_number(ctx["pid"], preview["series"])
        doc = {
            "id": str(uuid.uuid4()), "user_id": ctx["uid"], "profile_id": ctx["pid"],
            "number": number, "series": preview["series"], "type": "factura",
            "client_id": cid, "client_name": preview["client_name"],
            "client_nif": preview["client_nif"], "client_address": preview["client_address"],
            "client_email": preview["client_email"],
            "issue_date": preview["issue_date"], "due_date": preview["due_date"],
            "items": preview["items"], "notes": preview["notes"] or "Importado por IA",
            "status": "pendiente", "recurring": "none", "rectifies_id": "", "rectifies_number": "",
            "project_id": "", "tags": ["importada-ia"], "paid_amount": 0,
            "order_number": preview["order_number"],
            **totals, "created_at": now_iso(),
        }
        await db.invoices.insert_one(doc); doc.pop("_id", None)
        await audit(ctx, "invoice", doc["id"], doc["number"], "create", {"source": "ai_import"})
        return {"saved": True, "type": "invoice", "id": doc["id"], "number": doc["number"], "preview": preview}
    else:  # quote
        number = preview["number"] or await next_quote_number(ctx["pid"])
        doc = {
            "id": str(uuid.uuid4()), "user_id": ctx["uid"], "profile_id": ctx["pid"],
            "number": number, "client_id": cid, "client_name": preview["client_name"],
            "client_nif": preview["client_nif"], "client_address": preview["client_address"],
            "client_email": preview["client_email"],
            "issue_date": preview["issue_date"], "valid_until": preview["due_date"],
            "items": preview["items"], "notes": preview["notes"] or "Importado por IA",
            "status": "pendiente", "tags": ["importada-ia"],
            **totals, "created_at": now_iso(),
        }
        await db.quotes.insert_one(doc); doc.pop("_id", None)
        await audit(ctx, "quote", doc["id"], doc["number"], "create", {"source": "ai_import"})
        return {"saved": True, "type": "quote", "id": doc["id"], "number": doc["number"], "preview": preview}


class AIQuery(BaseModel):
    prompt: str


@api.post("/ai/generate-concept")
async def generate_concept(q: AIQuery, ctx=Depends(get_user_context)):
    if not groq_client:
        raise HTTPException(500, "Groq API no configurada")
    try:
        resp = groq_client.chat.completions.create(
            model=GROQ_TEXT_MODEL,
            messages=[
                {"role": "system", "content": "Eres un asistente para autónomos españoles. Genera conceptos de factura claros y profesionales en español. Responde SOLO con el concepto."},
                {"role": "user", "content": q.prompt},
            ],
            temperature=0.4, max_tokens=200,
        )
        return {"text": resp.choices[0].message.content.strip()}
    except Exception as e:
        raise HTTPException(500, str(e))


async def build_user_context(ctx) -> str:
    inv = await db.invoices.find(scope(ctx), {"_id": 0}).to_list(2000)
    exp = await db.expenses.find(scope(ctx), {"_id": 0}).to_list(2000)
    cli = await db.clients.find(scope(ctx), {"_id": 0}).to_list(2000)
    today = datetime.now().date(); year = today.year
    quarter = (today.month - 1) // 3 + 1
    qm = {1: ["01", "02", "03"], 2: ["04", "05", "06"], 3: ["07", "08", "09"], 4: ["10", "11", "12"]}[quarter]

    def f(items, k, dk, yf=None, ms=None, status=None):
        s = 0
        for it in items:
            if status and it.get("status") != status: continue
            d = it.get(dk, "")
            if yf and not d.startswith(str(yf)): continue
            if ms and (len(d) < 7 or d[5:7] not in ms): continue
            s += it.get(k, 0) or 0
        return round(s, 2)

    income_year = f(inv, "subtotal", "issue_date", year, status="pagada")
    income_q = f(inv, "subtotal", "issue_date", year, qm, status="pagada")
    iva_rep_q = f(inv, "iva_total", "issue_date", year, qm, status="pagada")
    irpf_q = f(inv, "irpf_total", "issue_date", year, qm, status="pagada")
    expenses_year = f(exp, "amount", "date", year)
    expenses_q = f(exp, "amount", "date", year, qm)
    iva_sop_q = sum((e.get("amount", 0) * (e.get("iva", 0) / (100 + e.get("iva", 21)))) for e in exp if e.get("date", "").startswith(str(year)) and e.get("date", "")[5:7] in qm)
    pending = [i for i in inv if i.get("status") == "pendiente"]
    overdue = [i for i in inv if i.get("status") == "vencida"]
    pending_amount = round(sum(i.get("total", 0) - i.get("paid_amount", 0) for i in pending), 2)
    top = {}
    for i in inv:
        if i.get("status") == "pagada" and i.get("issue_date", "").startswith(str(year)):
            top[i.get("client_name", "?")] = top.get(i.get("client_name", "?"), 0) + i.get("subtotal", 0)
    top_list = sorted(top.items(), key=lambda x: -x[1])[:3]
    cat_exp = {}
    for e in exp:
        if e.get("date", "").startswith(str(year)):
            cat_exp[e.get("category", "Otros")] = cat_exp.get(e.get("category", "Otros"), 0) + e.get("amount", 0)
    return (
        f"Perfil activo: {ctx['profile'].get('name')}.\n"
        f"Hoy: {today.isoformat()}. Año {year}, T{quarter}.\n"
        f"Ingresos año (base): {income_year}€. Trimestre: {income_q}€.\n"
        f"Gastos año: {expenses_year}€. Trimestre: {expenses_q}€.\n"
        f"Categorías gastos: {dict((k, round(v, 2)) for k, v in cat_exp.items())}\n"
        f"IVA T: rep {iva_rep_q}€, sop {round(iva_sop_q, 2)}€, liquidar {round(iva_rep_q - iva_sop_q, 2)}€\n"
        f"IRPF retenido T: {irpf_q}€\n"
        f"Pendientes: {len(pending)} ({pending_amount}€). Vencidas: {len(overdue)}.\n"
        f"Top clientes: {top_list}\n"
        f"Beneficio año: {round(income_year - expenses_year, 2)}€\n"
        f"Total clientes: {len(cli)}, facturas: {len(inv)}, gastos: {len(exp)}.\n"
    )


@api.post("/ai/chat")
async def ai_chat(data: AIChatIn, ctx=Depends(get_user_context)):
    if not groq_client:
        raise HTTPException(500, "Groq API no configurada")
    user_ctx = await build_user_context(ctx)
    session_id = data.session_id or str(uuid.uuid4())
    history = await db.ai_messages.find({"user_id": ctx["uid"], "profile_id": ctx["pid"], "session_id": session_id}, {"_id": 0}).sort("ts", 1).to_list(20)
    messages = [
        {"role": "system", "content": (
            "Eres FakturaFlow Asistente, asesor fiscal y contable virtual para autónomos españoles. "
            "Responde SIEMPRE en español, conciso y útil. Usa los datos REALES del usuario. "
            "Formato europeo (€, comas decimales). No inventes números.\n\n"
            f"CONTEXTO:\n{user_ctx}"
        )},
    ]
    for h in history:
        messages.append({"role": h["role"], "content": h["content"]})
    messages.append({"role": "user", "content": data.message})
    try:
        resp = groq_client.chat.completions.create(
            model=GROQ_TEXT_MODEL, messages=messages, temperature=0.3, max_tokens=600,
        )
        answer = resp.choices[0].message.content.strip()
        ts = now_iso()
        await db.ai_messages.insert_many([
            {"id": str(uuid.uuid4()), "user_id": ctx["uid"], "profile_id": ctx["pid"], "session_id": session_id, "role": "user", "content": data.message, "ts": ts},
            {"id": str(uuid.uuid4()), "user_id": ctx["uid"], "profile_id": ctx["pid"], "session_id": session_id, "role": "assistant", "content": answer, "ts": now_iso()},
        ])
        return {"answer": answer, "session_id": session_id}
    except Exception as e:
        logger.error(f"AI chat error: {e}")
        raise HTTPException(500, str(e))


@api.get("/ai/chat/history")
async def ai_chat_history(session_id: str, ctx=Depends(get_user_context)):
    return await db.ai_messages.find({"user_id": ctx["uid"], "profile_id": ctx["pid"], "session_id": session_id}, {"_id": 0}).sort("ts", 1).to_list(200)


@api.post("/ai/financial-summary")
async def financial_summary(ctx=Depends(get_user_context)):
    if not groq_client:
        raise HTTPException(500, "Groq API no configurada")
    user_ctx = await build_user_context(ctx)
    try:
        resp = groq_client.chat.completions.create(
            model=GROQ_TEXT_MODEL,
            messages=[
                {"role": "system", "content": "Eres asesor fiscal español para autónomos. Resumen breve (3-4 frases) y 2 recomendaciones prácticas en español."},
                {"role": "user", "content": user_ctx},
            ],
            temperature=0.5, max_tokens=400,
        )
        return {"summary": resp.choices[0].message.content.strip()}
    except Exception as e:
        raise HTTPException(500, str(e))


# ---------- DASHBOARD ----------
@api.get("/dashboard")
async def dashboard(ctx=Depends(get_user_context)):
    invoices = await db.invoices.find(scope(ctx), {"_id": 0}).to_list(2000)
    expenses = await db.expenses.find(scope(ctx), {"_id": 0}).to_list(2000)
    today = datetime.now().date()
    today_str = today.isoformat()
    for inv in invoices:
        if inv.get("status") == "pendiente" and inv.get("due_date") and inv["due_date"] < today_str:
            await db.invoices.update_one({"id": inv["id"]}, {"$set": {"status": "vencida"}})
            inv["status"] = "vencida"
    income_paid = sum(i.get("subtotal", 0) for i in invoices if i.get("status") == "pagada")
    iva_rep = sum(i.get("iva_total", 0) for i in invoices if i.get("status") == "pagada")
    iva_sop = sum(e.get("amount", 0) * (e.get("iva", 0) / (100 + e.get("iva", 21))) for e in expenses)
    expenses_total = sum(e.get("amount", 0) for e in expenses)
    benefit = income_paid - expenses_total
    months = []
    for k in range(5, -1, -1):
        d = today.replace(day=1) - timedelta(days=k * 30)
        ym = d.strftime("%Y-%m")
        m_income = sum(i.get("subtotal", 0) for i in invoices if i.get("status") == "pagada" and i.get("issue_date", "").startswith(ym))
        m_exp = sum(e.get("amount", 0) for e in expenses if e.get("date", "").startswith(ym))
        months.append({"month": d.strftime("%b"), "ingresos": round(m_income, 2), "gastos": round(m_exp, 2)})
    recent = sorted(invoices, key=lambda x: x.get("created_at", ""), reverse=True)[:5]
    return {
        "income_paid": round(income_paid, 2), "iva_rep": round(iva_rep, 2),
        "iva_sop": round(iva_sop, 2), "iva_balance": round(iva_rep - iva_sop, 2),
        "expenses": round(expenses_total, 2), "benefit": round(benefit, 2),
        "pending_count": sum(1 for i in invoices if i.get("status") == "pendiente"),
        "paid_count": sum(1 for i in invoices if i.get("status") == "pagada"),
        "overdue_count": sum(1 for i in invoices if i.get("status") == "vencida"),
        "monthly": months, "recent": recent,
    }


# ---------- FISCAL PROJECTION ----------
@api.get("/fiscal/projection")
async def fiscal_projection(ctx=Depends(get_user_context)):
    invoices = await db.invoices.find(scope(ctx), {"_id": 0}).to_list(2000)
    expenses = await db.expenses.find(scope(ctx), {"_id": 0}).to_list(2000)
    today = datetime.now().date(); year = today.year
    quarter = (today.month - 1) // 3 + 1
    qm = {1: ["01", "02", "03"], 2: ["04", "05", "06"], 3: ["07", "08", "09"], 4: ["10", "11", "12"]}[quarter]
    paid_inv = [i for i in invoices if i.get("status") == "pagada"]
    inv_year = [i for i in paid_inv if i.get("issue_date", "").startswith(str(year))]
    inv_q = [i for i in inv_year if i.get("issue_date", "")[5:7] in qm]
    exp_year = [e for e in expenses if e.get("date", "").startswith(str(year))]
    exp_q = [e for e in exp_year if e.get("date", "")[5:7] in qm]
    income_year = round(sum(i.get("subtotal", 0) for i in inv_year), 2)
    income_q = round(sum(i.get("subtotal", 0) for i in inv_q), 2)
    income_month = round(sum(i.get("subtotal", 0) for i in inv_year if i.get("issue_date", "").startswith(today.strftime("%Y-%m"))), 2)
    expenses_year = round(sum(e.get("amount", 0) for e in exp_year), 2)
    expenses_q = round(sum(e.get("amount", 0) for e in exp_q), 2)
    expenses_month = round(sum(e.get("amount", 0) for e in exp_year if e.get("date", "").startswith(today.strftime("%Y-%m"))), 2)
    iva_rep_q = round(sum(i.get("iva_total", 0) for i in inv_q), 2)
    iva_sop_q = round(sum(e.get("amount", 0) * (e.get("iva", 0) / (100 + e.get("iva", 21))) for e in exp_q), 2)
    iva_pay_q = round(iva_rep_q - iva_sop_q, 2)
    irpf_q = round(sum(i.get("irpf_total", 0) for i in inv_q), 2)
    irpf_130_estimate = round(max(0, (income_q - expenses_q) * 0.20 - irpf_q), 2)
    day_of_year = today.timetuple().tm_yday
    ratio = 365 / max(day_of_year, 30)
    proj_income = round(income_year * ratio, 2)
    proj_expenses = round(expenses_year * ratio, 2)
    proj_benefit = round(proj_income - proj_expenses, 2)
    proj_irpf_yearly = round(max(0, proj_benefit * 0.20), 2)
    proj_iva_yearly = round((iva_rep_q - iva_sop_q) * 4, 2)
    return {
        "today": today.isoformat(), "year": year, "quarter": quarter,
        "current": {
            "income_month": income_month, "income_quarter": income_q, "income_year": income_year,
            "expenses_month": expenses_month, "expenses_quarter": expenses_q, "expenses_year": expenses_year,
            "benefit_month": round(income_month - expenses_month, 2),
            "benefit_quarter": round(income_q - expenses_q, 2),
            "benefit_year": round(income_year - expenses_year, 2),
        },
        "current_quarter_taxes": {
            "iva_rep": iva_rep_q, "iva_sop": iva_sop_q,
            "iva_a_pagar_303": iva_pay_q, "irpf_retenido": irpf_q,
            "irpf_130_estimado": irpf_130_estimate,
        },
        "yearly_projection": {
            "income": proj_income, "expenses": proj_expenses, "benefit": proj_benefit,
            "irpf_estimated": proj_irpf_yearly, "iva_estimated": proj_iva_yearly,
            "tax_total_estimated": round(proj_irpf_yearly + max(0, proj_iva_yearly), 2),
        },
    }


# ---------- ACCOUNTING ----------
async def _get_books(ctx, year: int, quarter: Optional[int] = None):
    invoices = await db.invoices.find(scope(ctx), {"_id": 0}).to_list(5000)
    expenses = await db.expenses.find(scope(ctx), {"_id": 0}).to_list(5000)
    if quarter:
        qm = {1: ["01", "02", "03"], 2: ["04", "05", "06"], 3: ["07", "08", "09"], 4: ["10", "11", "12"]}[quarter]
        inv = [i for i in invoices if i.get("issue_date", "").startswith(str(year)) and i.get("issue_date", "")[5:7] in qm]
        exp = [e for e in expenses if e.get("date", "").startswith(str(year)) and e.get("date", "")[5:7] in qm]
    else:
        inv = [i for i in invoices if i.get("issue_date", "").startswith(str(year))]
        exp = [e for e in expenses if e.get("date", "").startswith(str(year))]
    inv = sorted(inv, key=lambda x: (x.get("issue_date", ""), x.get("number", "")))
    exp = sorted(exp, key=lambda x: x.get("date", ""))
    return inv, exp


@api.get("/accounting/books")
async def accounting_books(year: int, quarter: Optional[int] = None, ctx=Depends(get_user_context)):
    inv, exp = await _get_books(ctx, year, quarter)
    libro_ingresos, iva_rep_lines = [], []
    for i in inv:
        libro_ingresos.append({
            "date": i.get("issue_date"), "number": i.get("number"),
            "client": i.get("client_name"), "nif": i.get("client_nif", ""),
            "type": i.get("type", "factura"),
            "base": round(i.get("subtotal", 0), 2),
            "iva": round(i.get("iva_total", 0), 2),
            "irpf": round(i.get("irpf_total", 0), 2),
            "total": round(i.get("total", 0), 2), "status": i.get("status"),
        })
        iva_rep_lines.append({"date": i.get("issue_date"), "number": i.get("number"),
                              "client": i.get("client_name"), "base": round(i.get("subtotal", 0), 2),
                              "iva": round(i.get("iva_total", 0), 2)})
    libro_gastos, iva_sop_lines = [], []
    for e in exp:
        iva_pct = e.get("iva", 0) or 0
        gross = e.get("amount", 0) or 0
        iva_amount = round(gross * iva_pct / (100 + iva_pct), 2) if iva_pct else 0
        base = round(gross - iva_amount, 2)
        libro_gastos.append({"date": e.get("date"), "supplier": e.get("supplier", ""),
                             "description": e.get("description"), "category": e.get("category", ""),
                             "base": base, "iva": iva_amount, "total": round(gross, 2),
                             "method": e.get("payment_method", "")})
        iva_sop_lines.append({"date": e.get("date"), "supplier": e.get("supplier", ""), "base": base, "iva": iva_amount})
    totals = {
        "ingresos_base": round(sum(l["base"] for l in libro_ingresos), 2),
        "ingresos_iva": round(sum(l["iva"] for l in libro_ingresos), 2),
        "ingresos_irpf": round(sum(l["irpf"] for l in libro_ingresos), 2),
        "ingresos_total": round(sum(l["total"] for l in libro_ingresos), 2),
        "gastos_base": round(sum(l["base"] for l in libro_gastos), 2),
        "gastos_iva": round(sum(l["iva"] for l in libro_gastos), 2),
        "gastos_total": round(sum(l["total"] for l in libro_gastos), 2),
        "iva_rep": round(sum(l["iva"] for l in iva_rep_lines), 2),
        "iva_sop": round(sum(l["iva"] for l in iva_sop_lines), 2),
    }
    totals["iva_a_liquidar"] = round(totals["iva_rep"] - totals["iva_sop"], 2)
    totals["beneficio"] = round(totals["ingresos_base"] - totals["gastos_base"], 2)
    return {"year": year, "quarter": quarter, "libro_ingresos": libro_ingresos,
            "libro_gastos": libro_gastos, "iva_rep_lines": iva_rep_lines,
            "iva_sop_lines": iva_sop_lines, "totals": totals}


# ---------- HACIENDA MODELS PDFs ----------
def aeat_header(elements, profile, model: str, title: str, year: int, period: str):
    from reportlab.lib.units import mm
    from reportlab.lib import colors
    from reportlab.platypus import Paragraph, Table, TableStyle, Spacer
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    s = getSampleStyleSheet()
    h1 = ParagraphStyle("h1", parent=s["Heading1"], fontSize=14, textColor=colors.HexColor("#0F172A"))
    sub = ParagraphStyle("sub", parent=s["Normal"], fontSize=8, textColor=colors.HexColor("#64748B"))
    body = ParagraphStyle("body", parent=s["Normal"], fontSize=9)
    elements.append(Paragraph("AGENCIA TRIBUTARIA · BORRADOR NO OFICIAL", sub))
    elements.append(Paragraph(f"<b>Modelo {model}</b> — {title}", h1))
    elements.append(Paragraph(f"Borrador interno · No tiene validez fiscal oficial", sub))
    elements.append(Spacer(1, 8))
    info = [
        ["Declarante", profile.get("fiscal_name", ""), "NIF", profile.get("nif", "")],
        ["Ejercicio", str(year), "Periodo", period],
    ]
    t = Table(info, colWidths=[28 * mm, 60 * mm, 20 * mm, 60 * mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#F1F5F9")),
        ("BACKGROUND", (2, 0), (2, -1), colors.HexColor("#F1F5F9")),
        ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#0F172A")),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#CBD5E1")),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    elements.append(t); elements.append(Spacer(1, 12))


def casillas_table(elements, rows):
    from reportlab.lib.units import mm
    from reportlab.lib import colors
    from reportlab.platypus import Table, TableStyle, Spacer
    data = [["Cas.", "Concepto", "Base imponible", "Tipo", "Cuota"]]
    for r in rows:
        data.append(r)
    t = Table(data, colWidths=[14 * mm, 80 * mm, 30 * mm, 18 * mm, 30 * mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0F172A")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#0F172A")),
        ("INNERGRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#CBD5E1")),
        ("ALIGN", (2, 1), (-1, -1), "RIGHT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
    ]))
    elements.append(t); elements.append(Spacer(1, 8))


def generate_modelo_303(profile, books, year, quarter) -> io.BytesIO:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib import colors
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=15 * mm, rightMargin=15 * mm, topMargin=15 * mm, bottomMargin=15 * mm)
    elements = []
    aeat_header(elements, profile, "303", "IVA - Autoliquidación", year, f"{quarter}T")
    s = getSampleStyleSheet()
    bold = ParagraphStyle("b", parent=s["Normal"], fontSize=10, fontName="Helvetica-Bold", textColor=colors.HexColor("#0F172A"))
    elements.append(Paragraph("IVA Devengado", bold)); elements.append(Spacer(1, 4))
    # Group iva_rep by IVA type — simplified, all 21%
    base_21 = books["totals"]["ingresos_base"]
    iva_21 = books["totals"]["iva_rep"]
    casillas_table(elements, [
        ["01", "Régimen general - Tipo 21%", f"{base_21:.2f} €", "21%", f"{iva_21:.2f} €"],
        ["04", "Régimen general - Tipo 10%", "0,00 €", "10%", "0,00 €"],
        ["07", "Régimen general - Tipo 4%", "0,00 €", "4%", "0,00 €"],
        ["27", "Total cuota devengada", "", "", f"{iva_21:.2f} €"],
    ])
    elements.append(Paragraph("IVA Deducible", bold)); elements.append(Spacer(1, 4))
    base_g = books["totals"]["gastos_base"]
    iva_g = books["totals"]["iva_sop"]
    casillas_table(elements, [
        ["28", "Por cuotas soportadas en operaciones interiores", f"{base_g:.2f} €", "", f"{iva_g:.2f} €"],
        ["45", "Total a deducir", "", "", f"{iva_g:.2f} €"],
    ])
    elements.append(Paragraph("Resultado", bold)); elements.append(Spacer(1, 4))
    resultado = books["totals"]["iva_a_liquidar"]
    res_style = "color:#059669" if resultado < 0 else "color:#DC2626"
    casillas_table(elements, [
        ["46", "Resultado régimen general (27 - 45)", "", "", f"{resultado:.2f} €"],
        ["64", "Resultado de la autoliquidación (a ingresar/devolver)", "", "", f"{resultado:.2f} €"],
    ])
    elements.append(Spacer(1, 12))
    elements.append(Paragraph(f"<b>Total a {'devolver' if resultado < 0 else 'ingresar'}: {abs(resultado):.2f} €</b>", bold))
    doc.build(elements)
    buf.seek(0); return buf


def generate_modelo_130(profile, books, year, quarter) -> io.BytesIO:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib import colors
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=15 * mm, rightMargin=15 * mm, topMargin=15 * mm, bottomMargin=15 * mm)
    elements = []
    aeat_header(elements, profile, "130", "IRPF - Pago fraccionado", year, f"{quarter}T")
    s = getSampleStyleSheet()
    bold = ParagraphStyle("b", parent=s["Normal"], fontSize=10, fontName="Helvetica-Bold", textColor=colors.HexColor("#0F172A"))
    elements.append(Paragraph("Actividades económicas en estimación directa", bold)); elements.append(Spacer(1, 4))
    ingresos = books["totals"]["ingresos_base"]
    gastos = books["totals"]["gastos_base"]
    rendimiento = ingresos - gastos
    pago_fraccionado = round(max(0, rendimiento * 0.20), 2)
    irpf_retenido = books["totals"]["ingresos_irpf"]
    diferencia = round(pago_fraccionado - irpf_retenido, 2)
    casillas_table(elements, [
        ["01", "Ingresos computables", f"{ingresos:.2f} €", "", ""],
        ["02", "Gastos deducibles", f"{gastos:.2f} €", "", ""],
        ["03", "Rendimiento neto (01 - 02)", f"{rendimiento:.2f} €", "", ""],
        ["04", "20% de la casilla 03", "", "", f"{pago_fraccionado:.2f} €"],
        ["06", "Retenciones soportadas", "", "", f"{irpf_retenido:.2f} €"],
        ["07", "Diferencia (04 - 06)", "", "", f"{diferencia:.2f} €"],
        ["19", "Resultado de la autoliquidación", "", "", f"{max(0, diferencia):.2f} €"],
    ])
    elements.append(Spacer(1, 12))
    elements.append(Paragraph(f"<b>Total a ingresar: {max(0, diferencia):.2f} €</b>", bold))
    doc.build(elements)
    buf.seek(0); return buf


def generate_modelo_390(profile, books, year) -> io.BytesIO:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib import colors
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=15 * mm, rightMargin=15 * mm, topMargin=15 * mm, bottomMargin=15 * mm)
    elements = []
    aeat_header(elements, profile, "390", "IVA - Resumen anual", year, "ANUAL")
    s = getSampleStyleSheet()
    bold = ParagraphStyle("b", parent=s["Normal"], fontSize=10, fontName="Helvetica-Bold", textColor=colors.HexColor("#0F172A"))
    elements.append(Paragraph("Resumen anual del IVA", bold)); elements.append(Spacer(1, 4))
    casillas_table(elements, [
        ["100", "Total bases imponibles devengadas", f"{books['totals']['ingresos_base']:.2f} €", "", ""],
        ["101", "Total cuotas IVA devengadas", "", "", f"{books['totals']['iva_rep']:.2f} €"],
        ["595", "Total bases imponibles deducibles", f"{books['totals']['gastos_base']:.2f} €", "", ""],
        ["597", "Total cuotas IVA soportadas deducibles", "", "", f"{books['totals']['iva_sop']:.2f} €"],
        ["662", "Resultado anual (101 - 597)", "", "", f"{books['totals']['iva_a_liquidar']:.2f} €"],
    ])
    elements.append(Spacer(1, 12))
    elements.append(Paragraph(f"<b>Diferencia anual a liquidar: {books['totals']['iva_a_liquidar']:.2f} €</b>", bold))
    doc.build(elements)
    buf.seek(0); return buf


@api.get("/hacienda/modelo-303/{year}/{quarter}")
async def modelo_303_pdf(year: int, quarter: int, ctx=Depends(get_user_context)):
    inv, exp = await _get_books(ctx, year, quarter)
    books = await accounting_books(year, quarter, ctx)
    buf = generate_modelo_303(ctx["profile"], books, year, quarter)
    return StreamingResponse(buf, media_type="application/pdf",
                             headers={"Content-Disposition": f"attachment; filename=modelo-303-{year}-T{quarter}.pdf"})


@api.get("/hacienda/modelo-130/{year}/{quarter}")
async def modelo_130_pdf(year: int, quarter: int, ctx=Depends(get_user_context)):
    books = await accounting_books(year, quarter, ctx)
    buf = generate_modelo_130(ctx["profile"], books, year, quarter)
    return StreamingResponse(buf, media_type="application/pdf",
                             headers={"Content-Disposition": f"attachment; filename=modelo-130-{year}-T{quarter}.pdf"})


@api.get("/hacienda/modelo-390/{year}")
async def modelo_390_pdf(year: int, ctx=Depends(get_user_context)):
    books = await accounting_books(year, None, ctx)
    buf = generate_modelo_390(ctx["profile"], books, year)
    return StreamingResponse(buf, media_type="application/pdf",
                             headers={"Content-Disposition": f"attachment; filename=modelo-390-{year}.pdf"})


# ---------- ZIP "Preparar trimestre" ----------
@api.get("/hacienda/preparar-trimestre/{year}/{quarter}")
async def preparar_trimestre(year: int, quarter: int, ctx=Depends(get_user_context)):
    inv, exp = await _get_books(ctx, year, quarter)
    books = await accounting_books(year, quarter, ctx)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        # 1. Libros CSV
        def to_csv(rows):
            if not rows: return ""
            headers = list(rows[0].keys())
            lines = [",".join(headers)]
            for r in rows:
                lines.append(",".join(f'"{str(r.get(h, "")).replace(chr(34), chr(34)*2)}"' for h in headers))
            return "\n".join(lines)
        z.writestr(f"libro-ingresos-{year}-T{quarter}.csv", to_csv(books["libro_ingresos"]))
        z.writestr(f"libro-gastos-{year}-T{quarter}.csv", to_csv(books["libro_gastos"]))
        z.writestr(f"iva-repercutido-{year}-T{quarter}.csv", to_csv(books["iva_rep_lines"]))
        z.writestr(f"iva-soportado-{year}-T{quarter}.csv", to_csv(books["iva_sop_lines"]))
        # 2. Modelos PDF
        m303 = generate_modelo_303(ctx["profile"], books, year, quarter)
        z.writestr(f"modelo-303-{year}-T{quarter}.pdf", m303.getvalue())
        m130 = generate_modelo_130(ctx["profile"], books, year, quarter)
        z.writestr(f"modelo-130-{year}-T{quarter}.pdf", m130.getvalue())
        # 3. Facturas individuales PDF
        for i in inv:
            try:
                pdf = generate_invoice_pdf(i, ctx["profile"])
                z.writestr(f"facturas/factura-{i['number']}.pdf", pdf.getvalue())
            except Exception as ex:
                logger.error(f"PDF fail for {i.get('number')}: {ex}")
        # 4. Resumen JSON
        z.writestr(f"resumen-{year}-T{quarter}.json", json.dumps({
            "year": year, "quarter": quarter,
            "profile": {"name": ctx["profile"].get("name"), "nif": ctx["profile"].get("nif")},
            "totals": books["totals"],
            "n_invoices": len(inv), "n_expenses": len(exp),
        }, ensure_ascii=False, indent=2))
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/zip",
                             headers={"Content-Disposition": f"attachment; filename=trimestre-{year}-T{quarter}.zip"})


# ---------- REPORTS (kept) ----------
@api.get("/reports/quarter/{year}/{quarter}")
async def quarter_report(year: int, quarter: int, ctx=Depends(get_user_context)):
    months = {1: ["01", "02", "03"], 2: ["04", "05", "06"], 3: ["07", "08", "09"], 4: ["10", "11", "12"]}
    if quarter not in months:
        raise HTTPException(400, "Trimestre inválido")
    ms = months[quarter]
    invoices = await db.invoices.find(scope(ctx, {"status": "pagada"}), {"_id": 0}).to_list(2000)
    expenses = await db.expenses.find(scope(ctx), {"_id": 0}).to_list(2000)
    inv_q = [i for i in invoices if i.get("issue_date", "").startswith(f"{year}-") and i.get("issue_date", "")[5:7] in ms]
    exp_q = [e for e in expenses if e.get("date", "").startswith(f"{year}-") and e.get("date", "")[5:7] in ms]
    iva_rep = sum(i.get("iva_total", 0) for i in inv_q)
    iva_sop = sum(e.get("amount", 0) * (e.get("iva", 0) / (100 + e.get("iva", 21))) for e in exp_q)
    irpf = sum(i.get("irpf_total", 0) for i in inv_q)
    income = sum(i.get("subtotal", 0) for i in inv_q)
    spent = sum(e.get("amount", 0) for e in exp_q)
    return {"year": year, "quarter": quarter,
            "iva_rep": round(iva_rep, 2), "iva_sop": round(iva_sop, 2),
            "iva_pay": round(iva_rep - iva_sop, 2), "irpf": round(irpf, 2),
            "income": round(income, 2), "expenses": round(spent, 2),
            "benefit": round(income - spent, 2),
            "invoices": inv_q, "expense_items": exp_q}


@api.get("/reports/year/{year}")
async def year_report(year: int, ctx=Depends(get_user_context)):
    invoices = await db.invoices.find(scope(ctx, {"status": "pagada"}), {"_id": 0}).to_list(2000)
    expenses = await db.expenses.find(scope(ctx), {"_id": 0}).to_list(2000)
    inv_y = [i for i in invoices if i.get("issue_date", "").startswith(str(year))]
    exp_y = [e for e in expenses if e.get("date", "").startswith(str(year))]
    income = sum(i.get("subtotal", 0) for i in inv_y)
    spent = sum(e.get("amount", 0) for e in exp_y)
    clients_agg = {}
    for i in inv_y:
        clients_agg[i.get("client_name", "?")] = clients_agg.get(i.get("client_name", "?"), 0) + i.get("subtotal", 0)
    top_clients = sorted([{"name": k, "amount": round(v, 2)} for k, v in clients_agg.items()], key=lambda x: -x["amount"])[:5]
    monthly = []
    for m in range(1, 13):
        ms = f"{year}-{m:02d}"
        mi = sum(i.get("subtotal", 0) for i in inv_y if i.get("issue_date", "").startswith(ms))
        me = sum(e.get("amount", 0) for e in exp_y if e.get("date", "").startswith(ms))
        monthly.append({"month": ms, "ingresos": round(mi, 2), "gastos": round(me, 2)})
    return {"year": year, "income": round(income, 2), "expenses": round(spent, 2),
            "benefit": round(income - spent, 2),
            "estimated_tax": round((income - spent) * 0.20, 2),
            "top_clients": top_clients, "monthly": monthly}


# ---------- FISCAL CALENDAR ----------
@api.get("/fiscal-calendar/{year}")
async def fiscal_calendar(year: int, ctx=Depends(get_user_context)):
    return [
        {"date": f"{year}-01-30", "model": "Modelo 303", "description": "IVA - 4º Trimestre", "type": "iva"},
        {"date": f"{year}-01-30", "model": "Modelo 130", "description": "IRPF Pagos fraccionados - 4T", "type": "irpf"},
        {"date": f"{year}-01-30", "model": "Modelo 390", "description": "Resumen anual de IVA", "type": "iva"},
        {"date": f"{year}-01-31", "model": "Modelo 111", "description": "Retenciones IRPF - 4T", "type": "irpf"},
        {"date": f"{year}-01-31", "model": "Modelo 190", "description": "Resumen anual retenciones", "type": "irpf"},
        {"date": f"{year}-04-20", "model": "Modelo 303", "description": "IVA - 1º Trimestre", "type": "iva"},
        {"date": f"{year}-04-20", "model": "Modelo 130", "description": "IRPF Pagos fraccionados - 1T", "type": "irpf"},
        {"date": f"{year}-04-20", "model": "Modelo 111", "description": "Retenciones IRPF - 1T", "type": "irpf"},
        {"date": f"{year}-06-30", "model": "Modelo 100", "description": "Declaración Renta", "type": "renta"},
        {"date": f"{year}-07-20", "model": "Modelo 303", "description": "IVA - 2º Trimestre", "type": "iva"},
        {"date": f"{year}-07-20", "model": "Modelo 130", "description": "IRPF Pagos fraccionados - 2T", "type": "irpf"},
        {"date": f"{year}-07-20", "model": "Modelo 111", "description": "Retenciones IRPF - 2T", "type": "irpf"},
        {"date": f"{year}-10-20", "model": "Modelo 303", "description": "IVA - 3º Trimestre", "type": "iva"},
        {"date": f"{year}-10-20", "model": "Modelo 130", "description": "IRPF Pagos fraccionados - 3T", "type": "irpf"},
        {"date": f"{year}-10-20", "model": "Modelo 111", "description": "Retenciones IRPF - 3T", "type": "irpf"},
    ]


# ---------- SETTINGS (legacy compat - returns active profile data) ----------
@api.get("/settings")
async def get_settings(ctx=Depends(get_user_context)):
    return ctx["profile"]


# ---------- GLOBAL SEARCH ----------
@api.get("/search")
async def global_search(q: str, ctx=Depends(get_user_context)):
    if not q or len(q) < 2:
        return {"clients": [], "invoices": [], "expenses": [], "quotes": [], "projects": []}
    rgx = {"$regex": q, "$options": "i"}
    clients = await db.clients.find(scope(ctx, {"$or": [{"name": rgx}, {"company": rgx}, {"nif": rgx}]}), {"_id": 0}).limit(5).to_list(5)
    invoices = await db.invoices.find(scope(ctx, {"$or": [{"number": rgx}, {"client_name": rgx}]}), {"_id": 0}).limit(5).to_list(5)
    expenses = await db.expenses.find(scope(ctx, {"$or": [{"description": rgx}, {"supplier": rgx}]}), {"_id": 0}).limit(5).to_list(5)
    quotes = await db.quotes.find(scope(ctx, {"$or": [{"number": rgx}, {"client_name": rgx}]}), {"_id": 0}).limit(5).to_list(5)
    projects = await db.projects.find(scope(ctx, {"name": rgx}), {"_id": 0}).limit(5).to_list(5)
    return {"clients": clients, "invoices": invoices, "expenses": expenses, "quotes": quotes, "projects": projects}


@api.get("/")
async def root():
    return {"message": "FakturaFlow API", "version": "3.1"}


# ==================== PHASE 3 ====================

# ---------- SUBSCRIPTION / STRIPE ----------
@api.get("/subscription")
async def get_subscription(user=Depends(get_current_user)):
    """App is fully free. Always returns unlimited access."""
    return {
        "plan": "free", "status": "active", "current_period_end": "",
        "owner": True,
        "details": {"name": "Acceso completo", "price": 0, "max_invoices_month": -1, "max_profiles": -1,
                    "features": ["Todo incluido sin límites"]},
        "usage": {"invoices_this_month": 0, "limit": -1},
    }


# ---------- VERIFACTU (QR + hash chain) ----------
async def compute_verifactu_for_invoice(inv: dict, profile: dict) -> dict:
    """Returns {verifactu_uuid, hash, prev_hash, qr_payload}. Hash is SHA-256 chain."""
    prev = await db.invoices.find_one(
        {"user_id": inv["user_id"], "profile_id": inv["profile_id"], "verifactu_hash": {"$exists": True, "$ne": ""}},
        {"_id": 0, "verifactu_hash": 1}, sort=[("created_at", -1)]
    )
    prev_hash = (prev or {}).get("verifactu_hash", "0" * 64)
    payload = f"{inv['number']}|{inv.get('client_nif', '')}|{profile.get('nif', '')}|{inv['issue_date']}|{inv['total']:.2f}|{prev_hash}"
    h = hashlib.sha256(payload.encode()).hexdigest()
    uid = str(uuid.uuid4())
    qr_payload = f"https://verifactu.fakturaflow.es/v/{uid}?h={h[:16]}"
    return {"verifactu_uuid": uid, "verifactu_hash": h, "verifactu_prev_hash": prev_hash,
            "verifactu_qr": qr_payload, "verifactu_payload": payload}


def qr_png_base64(text: str) -> str:
    img = qrcode.make(text)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


@api.post("/invoices/{iid}/verifactu")
async def sign_verifactu(iid: str, ctx=Depends(get_user_context)):
    inv = await db.invoices.find_one(scope(ctx, {"id": iid}), {"_id": 0})
    if not inv:
        raise HTTPException(404, "Factura no encontrada")
    vf = await compute_verifactu_for_invoice(inv, ctx["profile"])
    await db.invoices.update_one({"id": iid}, {"$set": vf})
    return {"ok": True, **vf, "qr_png_b64": qr_png_base64(vf["verifactu_qr"])}


@api.get("/public/verifactu/{verifactu_uuid}")
async def public_verifactu(verifactu_uuid: str):
    inv = await db.invoices.find_one({"verifactu_uuid": verifactu_uuid}, {"_id": 0, "items": 0})
    if not inv:
        raise HTTPException(404, "Factura no verificable")
    profile = await db.profiles.find_one({"id": inv["profile_id"]}, {"_id": 0, "user_id": 0, "next_number": 0, "next_quote": 0})
    return {
        "verified": True, "number": inv.get("number"), "issue_date": inv.get("issue_date"),
        "total": inv.get("total"), "client_name": inv.get("client_name"),
        "client_nif": inv.get("client_nif"), "emisor": profile.get("fiscal_name") if profile else "",
        "emisor_nif": profile.get("nif") if profile else "", "hash": inv.get("verifactu_hash"),
        "prev_hash": inv.get("verifactu_prev_hash"), "verifactu_uuid": verifactu_uuid,
    }


@api.get("/verifactu/chain")
async def verifactu_chain(ctx=Depends(get_user_context)):
    """Inmutable log of issued invoices in this profile (Verifactu trazabilidad)."""
    events = await db.verifactu_events.find(
        {"profile_id": ctx["pid"]}, {"_id": 0}
    ).sort("created_at", 1).to_list(2000)
    return {"events": events, "count": len(events)}


# ---------- ADVISOR (Modo asesor IA pre-trimestre) ----------
@api.get("/ai/advisor-review")
async def advisor_review(year: Optional[int] = None, quarter: Optional[int] = None, ctx=Depends(get_user_context)):
    if not groq_client:
        raise HTTPException(500, "Groq API no configurada")
    year = year or datetime.now().year
    quarter = quarter or ((datetime.now().month - 1) // 3 + 1)
    qm = {1: ["01", "02", "03"], 2: ["04", "05", "06"], 3: ["07", "08", "09"], 4: ["10", "11", "12"]}[quarter]
    invoices = await db.invoices.find(scope(ctx), {"_id": 0}).to_list(2000)
    expenses = await db.expenses.find(scope(ctx), {"_id": 0}).to_list(2000)
    inv_q = [i for i in invoices if i.get("issue_date", "").startswith(str(year)) and i.get("issue_date", "")[5:7] in qm]
    exp_q = [e for e in expenses if e.get("date", "").startswith(str(year)) and e.get("date", "")[5:7] in qm]
    # Automated checks
    checks = []
    pending = [i for i in inv_q if i.get("status") != "pagada"]
    if pending:
        checks.append({"severity": "info", "title": f"{len(pending)} facturas pendientes de cobro", "detail": f"Suma total: {sum(i.get('total', 0) - i.get('paid_amount', 0) for i in pending):.2f}€"})
    overdue = [i for i in inv_q if i.get("status") == "vencida"]
    if overdue:
        checks.append({"severity": "warning", "title": f"{len(overdue)} facturas vencidas", "detail": "Considera reclamar a los clientes morosos"})
    no_iva_exp = [e for e in exp_q if not e.get("iva")]
    if no_iva_exp:
        checks.append({"severity": "warning", "title": f"{len(no_iva_exp)} gastos sin IVA registrado", "detail": "Revisa si pueden ser deducibles con IVA"})
    inv_no_irpf = [i for i in inv_q if sum(it.get("irpf", 0) for it in i.get("items", [])) == 0]
    if len(inv_no_irpf) == len(inv_q) and inv_q:
        checks.append({"severity": "info", "title": "Ninguna factura tiene IRPF", "detail": "Si trabajas con empresas, normalmente aplicas 15% IRPF"})
    # Duplicates
    seen = {}
    for e in exp_q:
        k = (e.get("supplier", ""), round(e.get("amount", 0), 2), e.get("date", ""))
        if k in seen:
            checks.append({"severity": "warning", "title": f"Posible gasto duplicado", "detail": f"{e.get('description')} ({e.get('amount')}€) registrado 2 veces"})
        seen[k] = True
    # AI summary
    ctx_text = (
        f"Trimestre {quarter}/{year}. Ingresos {sum(i.get('subtotal', 0) for i in inv_q):.2f}€. "
        f"Gastos {sum(e.get('amount', 0) for e in exp_q):.2f}€. "
        f"IVA repercutido {sum(i.get('iva_total', 0) for i in inv_q):.2f}€. "
        f"Facturas {len(inv_q)}, gastos {len(exp_q)}, pendientes {len(pending)}, vencidas {len(overdue)}."
    )
    try:
        resp = groq_client.chat.completions.create(
            model=GROQ_TEXT_MODEL,
            messages=[
                {"role": "system", "content": "Eres asesor fiscal español. Da un análisis pre-trimestre con 3-4 puntos clave en español y 2 recomendaciones accionables. Tono profesional y directo."},
                {"role": "user", "content": ctx_text},
            ],
            temperature=0.4, max_tokens=400,
        )
        ai_text = resp.choices[0].message.content.strip()
    except Exception:
        ai_text = "Análisis IA no disponible."
    return {"year": year, "quarter": quarter, "checks": checks, "ai_analysis": ai_text,
            "stats": {"invoices": len(inv_q), "expenses": len(exp_q), "pending": len(pending), "overdue": len(overdue)}}


# ---------- ENHANCED OCR with duplicate detection ----------
@api.post("/ai/ocr-receipt-advanced")
async def ocr_advanced(file: UploadFile = File(...), ctx=Depends(get_user_context)):
    if not groq_client:
        raise HTTPException(500, "Groq API no configurada")
    raw = await file.read()
    if len(raw) > 10 * 1024 * 1024:
        raise HTTPException(400, "Archivo demasiado grande")
    file_hash = hashlib.sha256(raw).hexdigest()
    duplicate = await db.expenses.find_one(scope(ctx, {"receipt_hash": file_hash}), {"_id": 0})
    if duplicate:
        return {"duplicate": True, "existing_id": duplicate["id"], "warning": "Este ticket ya fue procesado anteriormente",
                "existing_description": duplicate.get("description")}
    mime = (file.content_type or "image/jpeg").lower()
    fname = (file.filename or "").lower()
    if "pdf" in mime or fname.endswith(".pdf"):
        try:
            raw = pdf_first_page_to_jpeg_bytes(raw); mime = "image/jpeg"
        except Exception:
            raise HTTPException(400, "No se pudo procesar el PDF")
    b64 = base64.b64encode(raw).decode()
    prompt = (
        "Analiza este ticket/factura. JSON con: amount, iva (%), merchant, date (YYYY-MM-DD), "
        "category, description, has_nif (bool si aparece NIF/CIF del comprador), "
        "is_simplified (bool si es ticket simplificado sin datos completos), "
        "warnings (array strings: ej. 'IVA no detectado', 'falta NIF comprador', 'factura simplificada')."
    )
    try:
        resp = groq_client.chat.completions.create(
            model=GROQ_VISION_MODEL,
            messages=[{"role": "user", "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}},
            ]}],
            response_format={"type": "json_object"}, temperature=0.1, max_tokens=512,
        )
        data = json.loads(resp.choices[0].message.content)
        data["file_hash"] = file_hash
        data["duplicate"] = False
        return data
    except Exception as e:
        raise HTTPException(500, str(e))


# ---------- EMAIL (Resend) ----------
class SendInvoiceEmailIn(BaseModel):
    invoice_id: str
    to_email: EmailStr
    subject: Optional[str] = None
    body: Optional[str] = None


@api.post("/emails/send-invoice")
async def send_invoice_email(data: SendInvoiceEmailIn, ctx=Depends(get_user_context)):
    if not RESEND_API_KEY or RESEND_API_KEY.startswith("re_demo"):
        raise HTTPException(503, "Email no configurado. Añade RESEND_API_KEY en el .env del backend.")
    inv = await db.invoices.find_one(scope(ctx, {"id": data.invoice_id}), {"_id": 0})
    if not inv:
        raise HTTPException(404, "Factura no encontrada")
    pdf = generate_invoice_pdf(inv, ctx["profile"])
    subject = data.subject or f"Factura {inv['number']} de {ctx['profile'].get('fiscal_name', 'FakturaFlow')}"
    body = data.body or f"<p>Hola,</p><p>Adjuntamos la factura <b>{inv['number']}</b> por importe de <b>{inv['total']:.2f} €</b>.</p><p>Gracias por tu confianza.</p><p>— {ctx['profile'].get('fiscal_name', '')}</p>"
    try:
        result = resend.Emails.send({
            "from": "FakturaFlow <onboarding@resend.dev>",
            "to": [data.to_email], "subject": subject, "html": body,
            "attachments": [{"filename": f"factura-{inv['number']}.pdf", "content": list(pdf.getvalue())}],
        })
        await db.email_log.insert_one({"id": str(uuid.uuid4()), "user_id": ctx["uid"], "profile_id": ctx["pid"],
                                        "invoice_id": data.invoice_id, "to": data.to_email,
                                        "subject": subject, "resend_id": result.get("id"), "sent_at": now_iso()})
        return {"ok": True, "id": result.get("id")}
    except Exception as e:
        logger.error(f"Resend error: {e}")
        raise HTTPException(500, f"Error enviando email: {str(e)}")


# ---------- PORTAL CLIENTE (public quote acceptance) ----------
@api.post("/quotes/{qid}/share")
async def share_quote(qid: str, ctx=Depends(get_user_context)):
    q = await db.quotes.find_one(scope(ctx, {"id": qid}), {"_id": 0})
    if not q:
        raise HTTPException(404, "Presupuesto no encontrado")
    token = q.get("public_token") or secrets.token_urlsafe(24)
    await db.quotes.update_one({"id": qid}, {"$set": {"public_token": token}})
    return {"token": token, "url": f"/public/quote/{token}"}


@api.get("/public/quote/{token}")
async def public_get_quote(token: str):
    q = await db.quotes.find_one({"public_token": token}, {"_id": 0, "user_id": 0})
    if not q:
        raise HTTPException(404, "Presupuesto no disponible")
    profile = None
    if q.get("profile_id"):
        profile = await db.profiles.find_one(
            {"id": q["profile_id"]},
            {"_id": 0, "user_id": 0, "next_number": 0, "next_quote": 0},
        )
    # Hide profile_id from public response
    q.pop("profile_id", None)
    return {"quote": q, "issuer": profile}


class PortalActionIn(BaseModel):
    action: Literal["accept", "reject"]
    signature: Optional[str] = ""
    comment: Optional[str] = ""


@api.post("/public/quote/{token}/action")
async def public_quote_action(token: str, data: PortalActionIn):
    q = await db.quotes.find_one({"public_token": token}, {"_id": 0})
    if not q:
        raise HTTPException(404, "Presupuesto no encontrado")
    new_status = "aceptado" if data.action == "accept" else "rechazado"
    await db.quotes.update_one({"id": q["id"]}, {"$set": {
        "status": new_status, "public_action": data.action,
        "public_signature": data.signature or "", "public_comment": data.comment or "",
        "public_action_at": now_iso(),
    }})
    return {"ok": True, "status": new_status}


# ---------- BACKUPS ----------
@api.get("/backup/export")
async def backup_export(ctx=Depends(get_user_context)):
    """Exports all user data for current profile as ZIP of JSON files."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for coll in ("clients", "invoices", "expenses", "quotes", "projects", "time_entries", "payments"):
            data = await db[coll].find(scope(ctx), {"_id": 0}).to_list(10000)
            z.writestr(f"{coll}.json", json.dumps(data, ensure_ascii=False, indent=2, default=str))
        z.writestr("profile.json", json.dumps(ctx["profile"], ensure_ascii=False, indent=2, default=str))
        z.writestr("export-meta.json", json.dumps({"exported_at": now_iso(), "version": "3.0"}))
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/zip",
                             headers={"Content-Disposition": f"attachment; filename=fakturaflow-backup-{datetime.now().strftime('%Y%m%d-%H%M')}.zip"})


# ---------- HEALTH DASHBOARD ----------
@api.get("/analytics/health")
async def business_health(ctx=Depends(get_user_context)):
    today = datetime.now().date()
    year = today.year
    invoices = await db.invoices.find(scope(ctx), {"_id": 0}).to_list(2000)
    expenses = await db.expenses.find(scope(ctx), {"_id": 0}).to_list(2000)
    paid = [i for i in invoices if i.get("status") == "pagada"]
    pending = [i for i in invoices if i.get("status") in ("pendiente", "vencida")]
    pending_amount = sum(i.get("total", 0) - i.get("paid_amount", 0) for i in pending)
    cash_in_year = sum(i.get("subtotal", 0) for i in paid if i.get("issue_date", "").startswith(str(year)))
    cash_in_prev = sum(i.get("subtotal", 0) for i in paid if i.get("issue_date", "").startswith(str(year - 1)))
    growth = ((cash_in_year - cash_in_prev) / cash_in_prev * 100) if cash_in_prev else 0
    # Client concentration
    client_amounts = {}
    for i in paid:
        client_amounts[i.get("client_name", "?")] = client_amounts.get(i.get("client_name", "?"), 0) + i.get("subtotal", 0)
    total_clients_revenue = sum(client_amounts.values()) or 1
    top_share = max(client_amounts.values(), default=0) / total_clients_revenue * 100
    # Stability: coefficient of variation across months
    monthly = []
    for m in range(1, 13):
        ms = f"{year}-{m:02d}"
        monthly.append(sum(i.get("subtotal", 0) for i in paid if i.get("issue_date", "").startswith(ms)))
    avg = sum(monthly) / 12 if monthly else 0
    var = sum((m - avg) ** 2 for m in monthly) / 12 if monthly else 0
    cv = (var ** 0.5 / avg * 100) if avg else 0
    stability_score = max(0, min(100, 100 - cv))
    score = {
        "liquidity": round(max(0, 100 - (pending_amount / (cash_in_year + 1)) * 50), 1),
        "growth": round(max(-100, min(200, growth)), 1),
        "client_diversification": round(max(0, 100 - top_share), 1),
        "stability": round(stability_score, 1),
    }
    overall = round((score["liquidity"] + max(0, score["growth"]) + score["client_diversification"] + score["stability"]) / 4, 1)
    return {"overall_score": overall, "scores": score, "metrics": {
        "pending_amount": round(pending_amount, 2), "cash_in_year": round(cash_in_year, 2),
        "top_client_share_pct": round(top_share, 1), "growth_yoy_pct": round(growth, 1),
        "num_clients": len(client_amounts),
    }}


# ---------- REMINDERS ----------
@api.get("/reminders")
async def reminders(ctx=Depends(get_user_context)):
    out = []
    today = datetime.now().date()
    invoices = await db.invoices.find(scope(ctx), {"_id": 0}).to_list(2000)
    overdue = [i for i in invoices if i.get("status") == "vencida"]
    if overdue:
        out.append({"id": "overdue", "type": "warning", "title": f"{len(overdue)} facturas vencidas", "detail": f"Suma: {sum(i.get('total', 0) - i.get('paid_amount', 0) for i in overdue):.2f}€", "action": "/app/facturas"})
    pending = [i for i in invoices if i.get("status") == "pendiente"]
    if len(pending) >= 3:
        out.append({"id": "many_pending", "type": "info", "title": f"{len(pending)} facturas pendientes de cobro", "detail": "Considera enviar recordatorios", "action": "/app/facturas"})
    # Comparación trimestre actual vs anterior
    quarter = (today.month - 1) // 3 + 1
    qm = {1: ["01", "02", "03"], 2: ["04", "05", "06"], 3: ["07", "08", "09"], 4: ["10", "11", "12"]}
    cur_q = qm[quarter]
    prev_q_n = quarter - 1 if quarter > 1 else 4
    prev_year = today.year if quarter > 1 else today.year - 1
    prev_q = qm[prev_q_n]
    cur_income = sum(i.get("subtotal", 0) for i in invoices if i.get("status") == "pagada" and i.get("issue_date", "").startswith(str(today.year)) and i.get("issue_date", "")[5:7] in cur_q)
    prev_income = sum(i.get("subtotal", 0) for i in invoices if i.get("status") == "pagada" and i.get("issue_date", "").startswith(str(prev_year)) and i.get("issue_date", "")[5:7] in prev_q)
    if prev_income and cur_income < prev_income * 0.8:
        out.append({"id": "lower_q", "type": "warning", "title": "Ingresos del trimestre por debajo del anterior", "detail": f"Llevas {cur_income:.0f}€ vs {prev_income:.0f}€ del T{prev_q_n}", "action": "/app/panel-fiscal"})
    # Fiscal deadlines approaching
    deadlines = [
        (datetime(today.year, 4, 20).date(), "Modelo 303 T1"),
        (datetime(today.year, 7, 20).date(), "Modelo 303 T2"),
        (datetime(today.year, 10, 20).date(), "Modelo 303 T3"),
        (datetime(today.year + 1, 1, 30).date(), "Modelo 303 T4"),
    ]
    for d, name in deadlines:
        days = (d - today).days
        if 0 <= days <= 15:
            out.append({"id": f"deadline_{name}", "type": "warning", "title": f"{name} en {days} días", "detail": f"Vencimiento {d.isoformat()}", "action": "/app/calendario"})
    return out


# ---------- INVOICES PDF with QR (override existing) ----------
# (no separate endpoint — we extend generate_invoice_pdf to embed QR if verifactu_qr present)



# ==================== AUDIT LOG ====================

async def audit(ctx: dict, entity_type: str, entity_id: str, entity_label: str, action: str, changes: Optional[dict] = None):
    """Record a CRUD event in audit_log. Best-effort: never raises."""
    try:
        await db.audit_log.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": ctx["uid"],
            "profile_id": ctx["pid"],
            "actor_name": (ctx.get("user") or {}).get("name") or (ctx.get("user") or {}).get("email") or "",
            "entity_type": entity_type,
            "entity_id": entity_id,
            "entity_label": entity_label or "",
            "action": action,
            "changes": changes or {},
            "created_at": now_iso(),
        })
    except Exception as e:
        logger.warning(f"audit failed: {e}")


@api.get("/audit")
async def list_audit(entity_type: Optional[str] = None, entity_id: Optional[str] = None, limit: int = 200, ctx=Depends(get_user_context)):
    q = {"profile_id": ctx["pid"]}
    if entity_type:
        q["entity_type"] = entity_type
    if entity_id:
        q["entity_id"] = entity_id
    items = await db.audit_log.find(q, {"_id": 0}).sort("created_at", -1).limit(min(int(limit or 200), 1000)).to_list(1000)
    return items


# ==================== EXPORT CSV ====================

import csv as _csv


def _csv_response(rows: list, fields: list, filename: str) -> StreamingResponse:
    sio = io.StringIO()
    w = _csv.DictWriter(sio, fieldnames=fields, extrasaction="ignore")
    w.writeheader()
    for r in rows:
        w.writerow(r)
    sio.seek(0)
    return StreamingResponse(
        iter([sio.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@api.get("/export/clients.csv")
async def export_clients_csv(ctx=Depends(get_user_context)):
    rows = await db.clients.find(scope(ctx), {"_id": 0}).to_list(10000)
    fields = ["name", "company", "nif", "address", "email", "phone", "notes", "created_at"]
    return _csv_response(rows, fields, "clientes.csv")


@api.get("/export/invoices.csv")
async def export_invoices_csv(ctx=Depends(get_user_context)):
    invs = await db.invoices.find(scope(ctx), {"_id": 0}).to_list(10000)
    rows = []
    for i in invs:
        rows.append({
            "number": i.get("number", ""), "series": i.get("series", ""), "type": i.get("type", ""),
            "issue_date": i.get("issue_date", ""), "due_date": i.get("due_date", ""),
            "client_name": i.get("client_name", ""), "client_nif": i.get("client_nif", ""),
            "subtotal": i.get("subtotal", 0), "iva_total": i.get("iva_total", 0),
            "irpf_total": i.get("irpf_total", 0), "total": i.get("total", 0),
            "status": i.get("status", ""), "paid_amount": i.get("paid_amount", 0),
            "notes": i.get("notes", ""),
        })
    fields = ["number", "series", "type", "issue_date", "due_date", "client_name", "client_nif",
              "subtotal", "iva_total", "irpf_total", "total", "status", "paid_amount", "notes"]
    return _csv_response(rows, fields, "facturas.csv")


@api.get("/export/expenses.csv")
async def export_expenses_csv(ctx=Depends(get_user_context)):
    rows = await db.expenses.find(scope(ctx), {"_id": 0}).to_list(10000)
    fields = ["date", "supplier", "supplier_nif", "description", "category", "subtotal", "iva", "total", "notes"]
    return _csv_response(rows, fields, "gastos.csv")


# ==================== IMPORT CSV ====================

def _parse_float(v) -> float:
    if v is None or v == "":
        return 0.0
    try:
        return float(str(v).replace(",", "."))
    except Exception:
        return 0.0


@api.post("/import/clients")
async def import_clients(file: UploadFile = File(...), ctx=Depends(get_user_context)):
    content = (await file.read()).decode("utf-8-sig", errors="ignore")
    reader = _csv.DictReader(io.StringIO(content))
    created, skipped = 0, 0
    for row in reader:
        name = (row.get("name") or row.get("nombre") or "").strip()
        if not name:
            skipped += 1
            continue
        doc = {
            "id": str(uuid.uuid4()), "user_id": ctx["uid"], "profile_id": ctx["pid"],
            "name": name,
            "company": (row.get("company") or row.get("empresa") or "").strip(),
            "nif": (row.get("nif") or row.get("cif") or "").strip(),
            "address": (row.get("address") or row.get("direccion") or "").strip(),
            "email": (row.get("email") or "").strip(),
            "phone": (row.get("phone") or row.get("telefono") or "").strip(),
            "notes": (row.get("notes") or row.get("notas") or "").strip(),
            "tags": [],
            "created_at": now_iso(),
        }
        await db.clients.insert_one(doc)
        created += 1
    await audit(ctx, "import", "clients", f"{created} clientes", "import", {"created": created, "skipped": skipped})
    return {"ok": True, "created": created, "skipped": skipped}


@api.post("/import/expenses")
async def import_expenses(file: UploadFile = File(...), ctx=Depends(get_user_context)):
    content = (await file.read()).decode("utf-8-sig", errors="ignore")
    reader = _csv.DictReader(io.StringIO(content))
    created, skipped = 0, 0
    for row in reader:
        date = (row.get("date") or row.get("fecha") or "").strip()
        supplier = (row.get("supplier") or row.get("proveedor") or "").strip()
        if not date and not supplier:
            skipped += 1
            continue
        subtotal = _parse_float(row.get("subtotal") or row.get("base"))
        iva = _parse_float(row.get("iva"))
        total = _parse_float(row.get("total")) or round(subtotal + iva, 2)
        doc = {
            "id": str(uuid.uuid4()), "user_id": ctx["uid"], "profile_id": ctx["pid"],
            "date": date or datetime.now().date().isoformat(),
            "supplier": supplier,
            "supplier_nif": (row.get("supplier_nif") or row.get("nif") or "").strip(),
            "description": (row.get("description") or row.get("descripcion") or "").strip(),
            "category": (row.get("category") or row.get("categoria") or "otros").strip(),
            "subtotal": subtotal, "iva": iva, "total": total,
            "iva_rate": _parse_float(row.get("iva_rate") or row.get("iva_pct")) or 21,
            "notes": (row.get("notes") or row.get("notas") or "").strip(),
            "tags": [],
            "created_at": now_iso(),
        }
        await db.expenses.insert_one(doc)
        created += 1
    await audit(ctx, "import", "expenses", f"{created} gastos", "import", {"created": created, "skipped": skipped})
    return {"ok": True, "created": created, "skipped": skipped}


@api.post("/import/invoices")
async def import_invoices(file: UploadFile = File(...), ctx=Depends(get_user_context)):
    """Import simple flat invoices (one row = one invoice, single line item).
    Required fields: client_name (or client_nif), issue_date, total.
    Optional: number, series, due_date, status, subtotal, iva_total, irpf_total, notes, description.
    Will match client by NIF or name if exists, else creates one."""
    content = (await file.read()).decode("utf-8-sig", errors="ignore")
    reader = _csv.DictReader(io.StringIO(content))
    created, skipped = 0, 0
    for row in reader:
        client_name = (row.get("client_name") or row.get("cliente") or "").strip()
        client_nif = (row.get("client_nif") or row.get("nif_cliente") or "").strip()
        if not client_name and not client_nif:
            skipped += 1
            continue
        # Resolve or create client
        existing = None
        if client_nif:
            existing = await db.clients.find_one(scope(ctx, {"nif": client_nif}), {"_id": 0})
        if not existing and client_name:
            existing = await db.clients.find_one(scope(ctx, {"name": client_name}), {"_id": 0})
        if existing:
            cid = existing["id"]
        else:
            cid = str(uuid.uuid4())
            await db.clients.insert_one({
                "id": cid, "user_id": ctx["uid"], "profile_id": ctx["pid"],
                "name": client_name or client_nif, "company": "", "nif": client_nif,
                "address": "", "email": "", "phone": "", "notes": "", "tags": [],
                "created_at": now_iso(),
            })
        # Build invoice
        total = _parse_float(row.get("total"))
        subtotal = _parse_float(row.get("subtotal")) or round(total / 1.21, 2)
        iva_total = _parse_float(row.get("iva_total")) or round(total - subtotal, 2)
        irpf_total = _parse_float(row.get("irpf_total"))
        series = (row.get("series") or "A").strip()
        number = (row.get("number") or "").strip()
        if not number:
            number = await next_invoice_number(ctx["pid"], series)
        doc = {
            "id": str(uuid.uuid4()), "user_id": ctx["uid"], "profile_id": ctx["pid"],
            "number": number, "series": series, "type": "factura",
            "client_id": cid, "client_name": client_name or existing.get("name", "") if existing else client_name,
            "client_nif": client_nif, "client_address": "", "client_email": "",
            "issue_date": (row.get("issue_date") or row.get("fecha") or datetime.now().date().isoformat()).strip(),
            "due_date": (row.get("due_date") or row.get("vencimiento") or "").strip(),
            "items": [{
                "description": (row.get("description") or row.get("concepto") or "Importado").strip(),
                "quantity": 1.0, "price": subtotal, "iva": 21.0, "irpf": 0.0, "discount": 0.0,
            }],
            "notes": (row.get("notes") or row.get("notas") or "").strip(),
            "status": (row.get("status") or row.get("estado") or "pendiente").strip(),
            "recurring": "none", "rectifies_id": "", "rectifies_number": "",
            "project_id": "", "tags": [], "paid_amount": _parse_float(row.get("paid_amount")),
            "subtotal": subtotal, "iva_total": iva_total, "irpf_total": irpf_total, "total": total,
            "created_at": now_iso(),
        }
        await db.invoices.insert_one(doc)
        created += 1
    await audit(ctx, "import", "invoices", f"{created} facturas", "import", {"created": created, "skipped": skipped})
    return {"ok": True, "created": created, "skipped": skipped}


# ==================== ADVANCED SEARCH ====================

@api.get("/search/advanced")
async def advanced_search(
    entity: Literal["invoices", "expenses", "quotes", "clients"] = "invoices",
    q: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    min_amount: Optional[float] = None,
    max_amount: Optional[float] = None,
    status: Optional[str] = None,
    client_id: Optional[str] = None,
    tag: Optional[str] = None,
    ctx=Depends(get_user_context),
):
    query = scope(ctx)
    date_field = {"invoices": "issue_date", "expenses": "date", "quotes": "issue_date", "clients": "created_at"}[entity]
    amount_field = {"invoices": "total", "expenses": "total", "quotes": "total", "clients": None}[entity]
    if date_from or date_to:
        rng = {}
        if date_from: rng["$gte"] = date_from
        if date_to: rng["$lte"] = date_to
        query[date_field] = rng
    if amount_field and (min_amount is not None or max_amount is not None):
        rng = {}
        if min_amount is not None: rng["$gte"] = float(min_amount)
        if max_amount is not None: rng["$lte"] = float(max_amount)
        query[amount_field] = rng
    if status: query["status"] = status
    if client_id and entity in ("invoices", "quotes"): query["client_id"] = client_id
    if tag: query["tags"] = tag
    if q:
        rgx = {"$regex": q, "$options": "i"}
        if entity == "clients":
            query["$or"] = [{"name": rgx}, {"company": rgx}, {"nif": rgx}, {"email": rgx}]
        elif entity == "expenses":
            query["$or"] = [{"description": rgx}, {"supplier": rgx}, {"supplier_nif": rgx}]
        else:
            query["$or"] = [{"number": rgx}, {"client_name": rgx}, {"client_nif": rgx}, {"notes": rgx}]
    items = await db[entity].find(query, {"_id": 0}).sort(date_field, -1).limit(500).to_list(500)
    return {"entity": entity, "count": len(items), "items": items}


# ==================== DIGITAL SIGNATURE (visual + PAdES) ====================

try:
    from pyhanko.sign import signers as _pyhanko_signers
    from pyhanko.sign.fields import SigFieldSpec as _SigFieldSpec, append_signature_field as _append_sig_field
    from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter as _IPdfW
    from pyhanko.sign import PdfSignatureMetadata as _PdfSigMeta
    PYHANKO_OK = True
except Exception as _e:
    PYHANKO_OK = False
    logger.warning(f"pyhanko not available: {_e}")


@api.post("/profiles/{pid}/certificate")
async def upload_certificate(pid: str, file: UploadFile = File(...), password: str = Form(""), user=Depends(get_current_user)):
    """Upload a .p12/.pfx certificate (FNMT, DNIe, etc.). Stored encrypted-at-rest as base64."""
    profile = await db.profiles.find_one({"id": pid, "user_id": user["id"]}, {"_id": 0})
    if not profile:
        raise HTTPException(404, "Perfil no encontrado")
    raw = await file.read()
    if len(raw) > 200_000:
        raise HTTPException(400, "Certificado demasiado grande (max 200KB)")
    # Test the password
    if PYHANKO_OK:
        try:
            _pyhanko_signers.SimpleSigner.load_pkcs12_data(
                pkcs12_bytes=raw, other_certs=[],
                passphrase=password.encode() if password else None,
            )
        except Exception as e:
            logger.warning(f"cert upload validation failed: {e}")
            raise HTTPException(400, "Certificado inválido o contraseña incorrecta")
    cert_b64 = base64.b64encode(raw).decode()
    # NOTE: in production, encrypt with KMS. Here stored as base64 (admin-only DB).
    await db.profiles.update_one({"id": pid}, {"$set": {
        "cert_p12": cert_b64, "cert_password": password, "cert_uploaded_at": now_iso(),
        "cert_filename": file.filename,
    }})
    return {"ok": True, "filename": file.filename}


@api.get("/profiles/{pid}/certificate")
async def get_certificate_info(pid: str, user=Depends(get_current_user)):
    profile = await db.profiles.find_one({"id": pid, "user_id": user["id"]}, {"_id": 0, "cert_filename": 1, "cert_uploaded_at": 1, "cert_p12": 1})
    if profile is None:
        raise HTTPException(404, "Perfil no encontrado")
    return {
        "has_certificate": bool(profile.get("cert_p12")),
        "filename": profile.get("cert_filename", ""),
        "uploaded_at": profile.get("cert_uploaded_at", ""),
    }


@api.delete("/profiles/{pid}/certificate")
async def remove_certificate(pid: str, user=Depends(get_current_user)):
    await db.profiles.update_one({"id": pid, "user_id": user["id"]}, {"$unset": {"cert_p12": "", "cert_password": "", "cert_filename": "", "cert_uploaded_at": ""}})
    return {"ok": True}


@api.get("/invoices/{iid}/signed.pdf")
async def signed_invoice_pdf(iid: str, mode: str = "visual", ctx=Depends(get_user_context)):
    """Generate signed PDF.
    mode=visual : adds a stamp box with signer name + date (no crypto)
    mode=cripto : applies PAdES signature using profile's .p12
    """
    inv = await db.invoices.find_one(scope(ctx, {"id": iid}), {"_id": 0})
    if not inv:
        raise HTTPException(404, "Factura no encontrada")
    profile = ctx["profile"]
    base_buf = generate_invoice_pdf(inv, profile)

    if mode == "cripto":
        if not PYHANKO_OK:
            raise HTTPException(500, "Libreria de firma no disponible")
        cert_b64 = profile.get("cert_p12") or ""
        if not cert_b64:
            raise HTTPException(400, "Sube primero un certificado .p12/.pfx en Configuracion")
        try:
            pfx_bytes = base64.b64decode(cert_b64)
            signer = _pyhanko_signers.SimpleSigner.load_pkcs12_data(
                pkcs12_bytes=pfx_bytes, other_certs=[],
                passphrase=(profile.get("cert_password") or "").encode() or None,
            )
            writer = _IPdfW(base_buf)
            _append_sig_field(writer, sig_field_spec=_SigFieldSpec(sig_field_name="Firma"))
            out = io.BytesIO()
            meta = _PdfSigMeta(field_name="Firma", reason="Firma electronica de factura",
                               location="Espana", contact_info=profile.get("email", ""))
            pdf_signer = _pyhanko_signers.PdfSigner(meta, signer=signer)
            await pdf_signer.async_sign_pdf(writer, output=out)
            out.seek(0)
            await audit(ctx, "invoice", iid, inv.get("number", ""), "sign", {"mode": "cripto"})
            return StreamingResponse(out, media_type="application/pdf",
                                     headers={"Content-Disposition": f"attachment; filename=factura-{inv['number']}-firmada.pdf"})
        except Exception as e:
            logger.error(f"PAdES sign failed: {e}")
            raise HTTPException(500, f"Error firmando: {e}")

    # Visual signature: add a stamp page
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.lib import colors
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
    from pypdf import PdfWriter, PdfReader
    # Generate a stamp page
    stamp = io.BytesIO()
    sdoc = SimpleDocTemplate(stamp, pagesize=A4, leftMargin=22*mm, rightMargin=22*mm, topMargin=180*mm)
    styles = getSampleStyleSheet()
    small = ParagraphStyle("small", parent=styles["Normal"], fontSize=9, textColor=colors.HexColor("#475569"))
    bold = ParagraphStyle("bold", parent=styles["Normal"], fontSize=11, textColor=colors.HexColor("#0F172A"))
    stamp_tbl = Table([
        [Paragraph(f"<b>FIRMADO ELECTRONICAMENTE</b>", bold)],
        [Paragraph(f"Firmante: {profile.get('fiscal_name','')} (NIF {profile.get('nif','')})", small)],
        [Paragraph(f"Documento: Factura {inv.get('number','')}", small)],
        [Paragraph(f"Fecha y hora: {now_iso()}", small)],
        [Paragraph(f"Total: {inv.get('total',0):.2f} EUR", small)],
        [Paragraph(f"Hash Verifactu: {(inv.get('verifactu_hash','') or 'N/A')[:32]}...", small)],
    ], colWidths=[160*mm])
    stamp_tbl.setStyle(TableStyle([
        ("BOX", (0,0),(-1,-1), 1.5, colors.HexColor("#2563EB")),
        ("BACKGROUND",(0,0),(-1,0), colors.HexColor("#EFF6FF")),
        ("BOTTOMPADDING",(0,0),(-1,-1),8),
        ("TOPPADDING",(0,0),(-1,-1),8),
        ("LEFTPADDING",(0,0),(-1,-1),12),
    ]))
    sdoc.build([stamp_tbl])
    stamp.seek(0)
    # Merge base + stamp
    try:
        from pypdf import PdfWriter as _PW
        w = _PW()
        for p in PdfReader(base_buf).pages:
            w.add_page(p)
        for p in PdfReader(stamp).pages:
            w.add_page(p)
        out = io.BytesIO()
        w.write(out); out.seek(0)
        await audit(ctx, "invoice", iid, inv.get("number", ""), "sign", {"mode": "visual"})
        return StreamingResponse(out, media_type="application/pdf",
                                 headers={"Content-Disposition": f"attachment; filename=factura-{inv['number']}-firmada.pdf"})
    except Exception:
        base_buf.seek(0)
        return StreamingResponse(base_buf, media_type="application/pdf",
                                 headers={"Content-Disposition": f"attachment; filename=factura-{inv['number']}.pdf"})




# ==================== EMAIL TEMPLATES ====================

DEFAULT_TEMPLATES = {
    "invoice_new": {"subject": "Factura {{numero}} de {{emisor}}", "body": "Hola {{cliente}},\n\nAdjunto la factura {{numero}} con fecha {{fecha}} por importe de {{importe}}.\nVencimiento: {{vencimiento}}\n\nGracias.\n{{emisor}}"},
    "reminder": {"subject": "Recordatorio: factura {{numero}} pendiente", "body": "Hola {{cliente}},\n\nTe recordamos amablemente que la factura {{numero}} ({{importe}}) con vencimiento {{vencimiento}} sigue pendiente de pago.\n\nUn saludo,\n{{emisor}}"},
    "quote_sent": {"subject": "Presupuesto {{numero}}", "body": "Hola {{cliente}},\n\nAdjunto presupuesto {{numero}} por importe de {{importe}}, valido hasta {{vencimiento}}.\nQuedo a tu disposicion para cualquier ajuste.\n\n{{emisor}}"},
    "thanks_paid": {"subject": "Gracias por tu pago!", "body": "Hola {{cliente}},\n\nConfirmamos la recepcion del pago de la factura {{numero}} ({{importe}}).\nGracias por confiar en nosotros.\n\n{{emisor}}"},
}


def _render_template(tpl: dict, vars_: dict) -> dict:
    s = tpl.get("subject", "")
    b = tpl.get("body", "")
    for k, v in (vars_ or {}).items():
        token = "{{" + k + "}}"
        s = s.replace(token, str(v))
        b = b.replace(token, str(v))
    return {"subject": s, "body": b}


class EmailTemplateIn(BaseModel):
    type: Literal["invoice_new", "reminder", "quote_sent", "thanks_paid", "custom"]
    name: str
    subject: str
    body: str


@api.get("/email-templates")
async def list_email_templates(ctx=Depends(get_user_context)):
    items = await db.email_templates.find(scope(ctx), {"_id": 0}).to_list(100)
    have = {it["type"] for it in items}
    for t, content in DEFAULT_TEMPLATES.items():
        if t not in have:
            items.append({"id": f"default-{t}", "type": t, "name": f"Por defecto - {t}",
                          "subject": content["subject"], "body": content["body"],
                          "is_default": True, "profile_id": ctx["pid"]})
    return items


@api.post("/email-templates")
async def create_email_template(data: EmailTemplateIn, ctx=Depends(get_user_context)):
    doc = {"id": str(uuid.uuid4()), "user_id": ctx["uid"], "profile_id": ctx["pid"],
           **data.model_dump(), "is_default": False, "created_at": now_iso()}
    await db.email_templates.insert_one(doc)
    doc.pop("_id", None)
    await audit(ctx, "email_template", doc["id"], data.name, "create")
    return doc


@api.put("/email-templates/{tid}")
async def update_email_template(tid: str, data: EmailTemplateIn, ctx=Depends(get_user_context)):
    res = await db.email_templates.update_one(scope(ctx, {"id": tid}), {"$set": data.model_dump()})
    if res.matched_count == 0:
        raise HTTPException(404, "Plantilla no encontrada")
    await audit(ctx, "email_template", tid, data.name, "update")
    return {"ok": True}


@api.delete("/email-templates/{tid}")
async def delete_email_template(tid: str, ctx=Depends(get_user_context)):
    await db.email_templates.delete_one(scope(ctx, {"id": tid}))
    await audit(ctx, "email_template", tid, "", "delete")
    return {"ok": True}


@api.post("/email-templates/preview")
async def preview_template(payload: dict, ctx=Depends(get_user_context)):
    return _render_template({"subject": payload.get("subject", ""), "body": payload.get("body", "")}, payload.get("vars", {}))


# ==================== GESTOR/ACCOUNTANT PORTAL (read-only link) ====================

@api.post("/profiles/{pid}/gestor-link")
async def create_gestor_link(pid: str, user=Depends(get_current_user)):
    profile = await db.profiles.find_one({"id": pid, "user_id": user["id"]}, {"_id": 0})
    if not profile:
        raise HTTPException(404, "Perfil no encontrado")
    token = secrets.token_urlsafe(24)
    await db.profiles.update_one({"id": pid}, {"$set": {"gestor_token": token, "gestor_created_at": now_iso()}})
    return {"token": token, "url": f"/gestor/{token}", "fiscal_name": profile.get("fiscal_name", "")}


@api.get("/profiles/{pid}/gestor-link")
async def get_gestor_link(pid: str, user=Depends(get_current_user)):
    profile = await db.profiles.find_one({"id": pid, "user_id": user["id"]}, {"_id": 0, "gestor_token": 1, "gestor_created_at": 1})
    if not profile:
        raise HTTPException(404, "Perfil no encontrado")
    return {"token": profile.get("gestor_token", ""), "created_at": profile.get("gestor_created_at", "")}


@api.delete("/profiles/{pid}/gestor-link")
async def revoke_gestor_link(pid: str, user=Depends(get_current_user)):
    await db.profiles.update_one({"id": pid, "user_id": user["id"]}, {"$unset": {"gestor_token": "", "gestor_created_at": ""}})
    return {"ok": True}


async def _resolve_gestor_profile(token: str) -> dict:
    profile = await db.profiles.find_one({"gestor_token": token}, {"_id": 0})
    if not profile:
        raise HTTPException(404, "Enlace invalido o caducado")
    return profile


@api.get("/gestor/{token}/info")
async def gestor_info(token: str, year: Optional[int] = None):
    profile = await _resolve_gestor_profile(token)
    year = year or datetime.now().year
    pid = profile["id"]
    invoices = await db.invoices.find({"profile_id": pid, "issue_date": {"$regex": f"^{year}"}}, {"_id": 0}).to_list(5000)
    expenses = await db.expenses.find({"profile_id": pid, "date": {"$regex": f"^{year}"}}, {"_id": 0}).to_list(5000)
    return {
        "profile": {k: profile.get(k) for k in ("fiscal_name", "nif", "address", "email", "phone", "type")},
        "year": year,
        "stats": {
            "invoices_count": len(invoices),
            "expenses_count": len(expenses),
            "total_facturado": round(sum(i.get("total", 0) for i in invoices), 2),
            "total_gastos": round(sum(e.get("total", 0) for e in expenses), 2),
            "iva_repercutido": round(sum(i.get("iva_total", 0) for i in invoices), 2),
            "iva_soportado": round(sum(e.get("iva", 0) for e in expenses), 2),
        },
    }


@api.get("/gestor/{token}/invoices")
async def gestor_invoices(token: str, year: Optional[int] = None, quarter: Optional[int] = None):
    profile = await _resolve_gestor_profile(token)
    q = {"profile_id": profile["id"]}
    if year:
        if quarter:
            qm = {1: ["01","02","03"], 2: ["04","05","06"], 3: ["07","08","09"], 4: ["10","11","12"]}[quarter]
            q["$or"] = [{"issue_date": {"$regex": f"^{year}-{m}"}} for m in qm]
        else:
            q["issue_date"] = {"$regex": f"^{year}"}
    return await db.invoices.find(q, {"_id": 0}).sort("issue_date", -1).to_list(5000)


@api.get("/gestor/{token}/expenses")
async def gestor_expenses(token: str, year: Optional[int] = None, quarter: Optional[int] = None):
    profile = await _resolve_gestor_profile(token)
    q = {"profile_id": profile["id"]}
    if year:
        if quarter:
            qm = {1: ["01","02","03"], 2: ["04","05","06"], 3: ["07","08","09"], 4: ["10","11","12"]}[quarter]
            q["$or"] = [{"date": {"$regex": f"^{year}-{m}"}} for m in qm]
        else:
            q["date"] = {"$regex": f"^{year}"}
    return await db.expenses.find(q, {"_id": 0}).sort("date", -1).to_list(5000)


# ==================== CONTRACT GENERATOR (from quote) ====================

@api.get("/quotes/{qid}/contract.pdf")
async def quote_contract_pdf(qid: str, ctx=Depends(get_user_context)):
    q = await db.quotes.find_one(scope(ctx, {"id": qid}), {"_id": 0})
    if not q:
        raise HTTPException(404, "Presupuesto no encontrado")
    buf = _generate_contract_pdf(q, ctx["profile"])
    return StreamingResponse(buf, media_type="application/pdf",
                             headers={"Content-Disposition": f"attachment; filename=contrato-{q['number']}.pdf"})


def _generate_contract_pdf(q: dict, profile: dict) -> io.BytesIO:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.lib import colors
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=22*mm, rightMargin=22*mm, topMargin=20*mm, bottomMargin=22*mm)
    styles = getSampleStyleSheet()
    title = ParagraphStyle("t", parent=styles["Heading1"], textColor=colors.HexColor("#0F172A"), fontSize=16, alignment=1)
    h2 = ParagraphStyle("h2", parent=styles["Heading2"], textColor=colors.HexColor("#0F172A"), fontSize=12, spaceAfter=6)
    body = ParagraphStyle("body", parent=styles["Normal"], fontSize=10, leading=15, alignment=4)
    small = ParagraphStyle("small", parent=styles["Normal"], fontSize=9, textColor=colors.HexColor("#475569"))
    el = []
    el.append(Paragraph("CONTRATO DE PRESTACION DE SERVICIOS", title))
    el.append(Spacer(1, 6))
    el.append(Paragraph(f"Ref. presupuesto {q.get('number','')} - Fecha: {q.get('issue_date','')}", small))
    el.append(Spacer(1, 16))
    el.append(Paragraph("REUNIDOS", h2))
    el.append(Paragraph(f"<b>De una parte</b>, <b>{profile.get('fiscal_name','')}</b>, con NIF <b>{profile.get('nif','')}</b>, domicilio en {profile.get('address','')}, en adelante <b>EL PROVEEDOR</b>.", body))
    el.append(Spacer(1, 6))
    el.append(Paragraph(f"<b>Y de otra parte</b>, <b>{q.get('client_name','')}</b>, con NIF <b>{q.get('client_nif','')}</b>, domicilio en {q.get('client_address','')}, en adelante <b>EL CLIENTE</b>.", body))
    el.append(Spacer(1, 6))
    el.append(Paragraph("Ambas partes se reconocen capacidad legal suficiente para contratar y obligarse, y", body))
    el.append(Spacer(1, 12))
    el.append(Paragraph("EXPONEN", h2))
    el.append(Paragraph("I. Que EL PROVEEDOR esta interesado en prestar servicios profesionales en su ambito de actividad.", body))
    el.append(Paragraph("II. Que EL CLIENTE esta interesado en la contratacion de dichos servicios conforme al presupuesto referenciado.", body))
    el.append(Paragraph("III. Que ambas partes acuerdan formalizar el presente contrato conforme a las siguientes,", body))
    el.append(Spacer(1, 12))
    el.append(Paragraph("CLAUSULAS", h2))
    el.append(Paragraph("<b>PRIMERA. Objeto.</b> EL PROVEEDOR prestara a EL CLIENTE los siguientes servicios:", body))
    rows = [["Descripcion", "Cant.", "Precio", "Total"]]
    for it in q.get("items", []):
        line = (it.get("quantity",0) or 0) * (it.get("price",0) or 0)
        rows.append([it.get("description",""), f"{it.get('quantity','')}", f"{it.get('price',0):.2f} EUR", f"{line:.2f} EUR"])
    t = Table(rows, colWidths=[95*mm, 18*mm, 24*mm, 26*mm])
    t.setStyle(TableStyle([
        ("BACKGROUND",(0,0),(-1,0),colors.HexColor("#0F172A")),
        ("TEXTCOLOR",(0,0),(-1,0),colors.white),
        ("FONTSIZE",(0,0),(-1,-1),9),
        ("ROWBACKGROUNDS",(0,1),(-1,-1),[colors.white, colors.HexColor("#F8FAFC")]),
        ("BOTTOMPADDING",(0,0),(-1,-1),6),("TOPPADDING",(0,0),(-1,-1),6),
    ]))
    el.append(t)
    el.append(Spacer(1, 10))
    el.append(Paragraph(f"<b>SEGUNDA. Precio y forma de pago.</b> El importe total acordado es de <b>{q.get('total',0):.2f} EUR</b> (IVA incluido). Forma de pago segun condiciones del presupuesto. Se emitira factura conforme a la legislacion vigente.", body))
    el.append(Paragraph("<b>TERCERA. Plazo de ejecucion.</b> Los trabajos comenzaran tras la firma del presente contrato y el pago en su caso de la senal acordada, finalizando en el plazo estipulado en el presupuesto.", body))
    el.append(Paragraph("<b>CUARTA. Confidencialidad.</b> Ambas partes se obligan a guardar reserva absoluta sobre la informacion a la que tengan acceso con motivo de la presente relacion contractual.", body))
    el.append(Paragraph("<b>QUINTA. Proteccion de datos.</b> Las partes cumpliran con lo dispuesto en el Reglamento (UE) 2016/679 y la LOPDGDD. Los datos seran tratados con la finalidad de gestionar la relacion contractual.", body))
    el.append(Paragraph("<b>SEXTA. Resolucion.</b> El presente contrato podra resolverse por mutuo acuerdo, por incumplimiento grave de cualquiera de las partes, o por causas previstas en la legislacion.", body))
    el.append(Paragraph("<b>SEPTIMA. Propiedad intelectual.</b> Los derechos de propiedad intelectual sobre los entregables se cederan a EL CLIENTE tras el pago integro del importe acordado.", body))
    el.append(Paragraph("<b>OCTAVA. Jurisdiccion.</b> Para cualquier controversia derivada de este contrato, las partes se someten expresamente a los Juzgados y Tribunales del domicilio del PROVEEDOR.", body))
    el.append(Spacer(1, 18))
    el.append(Paragraph(f"Y en prueba de conformidad, firman el presente contrato a fecha {datetime.now().strftime('%d/%m/%Y')}.", body))
    el.append(Spacer(1, 32))
    sig_tbl = Table([
        [Paragraph("<b>EL PROVEEDOR</b>", body), Paragraph("<b>EL CLIENTE</b>", body)],
        [Paragraph(profile.get('fiscal_name',''), small), Paragraph(q.get('client_name',''), small)],
        [Paragraph(f"NIF: {profile.get('nif','')}", small), Paragraph(f"NIF: {q.get('client_nif','')}", small)],
    ], colWidths=[80*mm, 80*mm])
    sig_tbl.setStyle(TableStyle([("VALIGN",(0,0),(-1,-1),"TOP"),("TOPPADDING",(0,0),(-1,-1),24)]))
    el.append(sig_tbl)
    doc.build(el)
    buf.seek(0)
    return buf



app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=CORS_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Profile-Id"],
)


@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.profiles.create_index([("user_id", 1)])
    await db.clients.create_index([("user_id", 1), ("profile_id", 1)])
    await db.invoices.create_index([("user_id", 1), ("profile_id", 1), ("issue_date", -1)])
    await db.invoices.create_index([("verifactu_uuid", 1)], sparse=True)
    await db.expenses.create_index([("user_id", 1), ("profile_id", 1), ("date", -1)])
    await db.expenses.create_index([("user_id", 1), ("profile_id", 1), ("receipt_hash", 1)], sparse=True)
    await db.quotes.create_index([("user_id", 1), ("profile_id", 1), ("issue_date", -1)])
    await db.quotes.create_index([("public_token", 1)], sparse=True)
    await db.payments.create_index([("invoice_id", 1)])
    await db.projects.create_index([("user_id", 1), ("profile_id", 1)])
    await db.time_entries.create_index([("user_id", 1), ("profile_id", 1), ("project_id", 1), ("date", -1)])
    await db.documents.create_index([("user_id", 1), ("profile_id", 1), ("entity_type", 1), ("entity_id", 1)])
    await db.ai_messages.create_index([("user_id", 1), ("profile_id", 1), ("session_id", 1), ("ts", 1)])
    await db.payment_transactions.create_index([("user_id", 1), ("session_id", 1)])
    await db.email_log.create_index([("user_id", 1), ("invoice_id", 1)])

    # Migration: ensure all existing users have a default profile and backfill profile_id
    users = await db.users.find({}, {"_id": 0}).to_list(10000)
    for u in users:
        prof = await ensure_default_profile(u["id"], u.get("company") or u.get("name") or "Personal")
        # Backfill: any record without profile_id for this user gets the default profile
        for coll in ("clients", "invoices", "expenses", "quotes", "payments", "ai_messages"):
            await db[coll].update_many(
                {"user_id": u["id"], "$or": [{"profile_id": {"$exists": False}}, {"profile_id": ""}, {"profile_id": None}]},
                {"$set": {"profile_id": prof["id"]}},
            )
        # Migrate old settings doc into profile if profile is empty
        old_settings = await db.settings.find_one({"user_id": u["id"]}, {"_id": 0})
        if old_settings and not prof.get("nif"):
            update = {k: old_settings[k] for k in ("fiscal_name", "nif", "address", "phone", "email", "logo_url", "signature", "default_iva", "default_irpf", "invoice_series", "primary_color", "next_number", "next_quote") if k in old_settings}
            if update:
                await db.profiles.update_one({"id": prof["id"]}, {"$set": update})
    logger.info("FakturaFlow ready · Phase 2")


@app.on_event("shutdown")
async def shutdown():
    client.close()

