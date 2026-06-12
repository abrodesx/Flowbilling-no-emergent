import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ShieldCheck, AlertTriangle, FileText, Receipt } from "lucide-react";

const fmtEUR = (n) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n || 0);
const API = process.env.REACT_APP_BACKEND_URL;

export default function GestorPortal() {
  const { token } = useParams();
  const [info, setInfo] = useState(null);
  const [year, setYear] = useState(new Date().getFullYear());
  const [quarter, setQuarter] = useState("all");
  const [tab, setTab] = useState("invoices");
  const [list, setList] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await axios.get(`${API}/api/gestor/${token}/info?year=${year}`);
        setInfo(data);
      } catch (e) { setError(true); }
    })();
  }, [token, year]);

  useEffect(() => {
    (async () => {
      setList(null);
      const params = new URLSearchParams({ year });
      if (quarter !== "all") params.set("quarter", quarter);
      try {
        const { data } = await axios.get(`${API}/api/gestor/${token}/${tab}?${params.toString()}`);
        setList(data);
      } catch (e) { setList([]); }
    })();
  }, [token, tab, year, quarter]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="p-8 text-center max-w-md">
          <AlertTriangle className="h-10 w-10 text-amber-600 mx-auto mb-3" />
          <h1 className="font-heading text-xl font-bold">Enlace no válido</h1>
          <p className="text-sm text-muted-foreground mt-2">El enlace ha sido revocado o nunca existió. Pide al titular que te envíe uno nuevo.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center gap-3 pb-4 border-b border-border">
          <div className="h-10 w-10 rounded-md bg-emerald-500/10 text-emerald-600 flex items-center justify-center"><ShieldCheck className="h-5 w-5" /></div>
          <div className="flex-1">
            <h1 className="font-heading text-2xl font-bold">Portal del gestor</h1>
            <p className="text-xs text-muted-foreground">Acceso solo lectura · {info?.profile?.fiscal_name || "..."} · NIF {info?.profile?.nif || ""}</p>
          </div>
          <div className="flex gap-2">
            <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
              <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
              <SelectContent>{[2024,2025,2026,2027].map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={String(quarter)} onValueChange={setQuarter}>
              <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Anual</SelectItem>
                <SelectItem value="1">T1</SelectItem><SelectItem value="2">T2</SelectItem>
                <SelectItem value="3">T3</SelectItem><SelectItem value="4">T4</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {!info ? <Skeleton className="h-32" /> : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card className="p-4"><div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Facturado {year}</div><div className="num text-2xl font-bold mt-1">{fmtEUR(info.stats.total_facturado)}</div><div className="text-xs text-muted-foreground">{info.stats.invoices_count} facturas</div></Card>
            <Card className="p-4"><div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Gastos {year}</div><div className="num text-2xl font-bold mt-1">{fmtEUR(info.stats.total_gastos)}</div><div className="text-xs text-muted-foreground">{info.stats.expenses_count} gastos</div></Card>
            <Card className="p-4"><div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">IVA repercutido</div><div className="num text-2xl font-bold mt-1 text-emerald-600">{fmtEUR(info.stats.iva_repercutido)}</div></Card>
            <Card className="p-4"><div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">IVA soportado</div><div className="num text-2xl font-bold mt-1 text-blue-600">{fmtEUR(info.stats.iva_soportado)}</div></Card>
          </div>
        )}

        <div className="flex gap-1 border-b border-border">
          <button onClick={() => setTab("invoices")} className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === "invoices" ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}><FileText className="h-4 w-4 inline mr-1" />Facturas</button>
          <button onClick={() => setTab("expenses")} className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === "expenses" ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}><Receipt className="h-4 w-4 inline mr-1" />Gastos</button>
        </div>

        {!list ? <Skeleton className="h-64" /> : list.length === 0 ? (
          <Card className="p-12 text-center text-sm text-muted-foreground">Sin datos para el periodo seleccionado</Card>
        ) : (
          <Card className="p-0 overflow-hidden">
            <div className="divide-y divide-border">
              {list.map((it) => (
                <div key={it.id} className="px-4 py-3 grid grid-cols-12 gap-3 items-center">
                  <div className="col-span-3 text-xs">{tab === "invoices" ? it.issue_date : it.date}</div>
                  <div className="col-span-6 text-sm font-medium truncate">
                    {tab === "invoices" ? `${it.number} - ${it.client_name}` : `${it.supplier || "—"} · ${it.description || ""}`}
                  </div>
                  <div className="col-span-3 text-sm num text-right">{fmtEUR(it.total)}</div>
                </div>
              ))}
            </div>
          </Card>
        )}

        <p className="text-xs text-muted-foreground text-center pt-4">FakturaFlow · Portal del gestor · Acceso solo lectura</p>
      </div>
    </div>
  );
}
