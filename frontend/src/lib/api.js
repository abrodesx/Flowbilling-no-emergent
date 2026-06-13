import axios from "axios";

const BACKEND = process.env.REACT_APP_BACKEND_URL;
export const API_BASE = `${BACKEND}/api`;
const AUTH_TOKEN_KEY = "ff-access-token";

export const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
});

export function setAuthToken(token) {
  if (token) {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
    api.defaults.headers.common.Authorization = `Bearer ${token}`;
  } else {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    delete api.defaults.headers.common.Authorization;
  }
}

const _token = typeof window !== "undefined" ? localStorage.getItem(AUTH_TOKEN_KEY) : null;
if (_token) {
  api.defaults.headers.common.Authorization = `Bearer ${_token}`;
}

// Hydrate profile header from localStorage if present
const _stored = typeof window !== "undefined" ? localStorage.getItem("ff-profile") : null;
if (_stored) api.defaults.headers.common["X-Profile-Id"] = _stored;

export function formatApiError(err) {
  const detail = err?.response?.data?.detail;
  if (detail == null) return err?.message || "Algo salió mal. Inténtalo de nuevo.";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((e) => (e?.msg ? e.msg : JSON.stringify(e))).join(" ");
  if (detail?.msg) return detail.msg;
  if (detail?.message) return detail.message;
  return JSON.stringify(detail);
}

export const fmtEUR = (n) =>
  new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(Number(n || 0));

export const fmtDate = (s) => {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return s;
  }
};
