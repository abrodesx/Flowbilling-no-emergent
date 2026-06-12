import { useState } from "react";
import { api, fmtEUR } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Filter, Download } from "lucide-react";
import { toast } from "sonner";

const ENTITIES = [
  { key: "invoices", label: "Facturas" },
  { key: "quotes", label: "Presupuestos" },
  { key: "expenses", label: "Gastos" },
  { key: "clients", label: "Clientes" },
];

export default function AdvancedSearch() {
  const [filters, setFilters] = useState({
    entity: "invoices", q: "", date_from: "", date_to: "",
    min_amount: "", max_amount: "", status: "all", tag: "",
  });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const upd = (k) => (v) => setFilters({ ...filters, [k]: v });

  const run = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([k, v]) => {
        if (v !== "" && v !== "all") params.set(k, v);
      });
      const { data } = await api.get(`/search/advanced?${params.toString()}`);
      setData(data);
    } catch (e) { toast.error("Error en búsqueda"); }
    finally { setLoading(false); }
  };

  const renderRow = (it) => {
    if (filters.entity === "clients") return { left: it.name, mid: it.nif || "—", right: it.email || "" };
    if (filters.entity === "expenses") return { left: it.description || it.supplier, mid: it.date, right: fmtEUR(it.total) };
    return { left: `${it.number} · ${it.client_name}`, mid: it.issue_date, right: fmtEUR(it.total) };
  };

  return (
    <div className="space-y-6" data-testid="advanced-search-page">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-md bg-primary/10 text-primary flex items-center justify-center"><Search className="h-5 w-5" /></div>
        <div>
          <h1 className="font-heading text-3xl font-bold">Búsqueda avanzada</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Filtra por fechas, importes, estado y más en todas tus colecciones.</p>
        </div>
      </div>

      <Card className="p-4 space-y-3">
        <div className="grid md:grid-cols-4 gap-3">
          <div>
            <Label className="text-xs">Tipo</Label>
            <Select value={filters.entity} onValueChange={upd("entity")}>
              <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
              <SelectContent>{ENTITIES.map(e => <SelectItem key={e.key} value={e.key}>{e.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="md:col-span-3">
            <Label className="text-xs">Texto</Label>
            <Input value={filters.q} onChange={(e) => upd("q")(e.target.value)} className="mt-1.5" placeholder="Número, cliente, NIF, concepto..." data-testid="adv-q" />
          </div>
        </div>
        <div className="grid md:grid-cols-4 gap-3">
          <div><Label className="text-xs">Desde</Label><Input type="date" value={filters.date_from} onChange={(e) => upd("date_from")(e.target.value)} className="mt-1.5" /></div>
          <div><Label className="text-xs">Hasta</Label><Input type="date" value={filters.date_to} onChange={(e) => upd("date_to")(e.target.value)} className="mt-1.5" /></div>
          {filters.entity !== "clients" && (
            <>
              <div><Label className="text-xs">Importe mín. €</Label><Input type="number" value={filters.min_amount} onChange={(e) => upd("min_amount")(e.target.value)} className="mt-1.5 num" /></div>
              <div><Label className="text-xs">Importe máx. €</Label><Input type="number" value={filters.max_amount} onChange={(e) => upd("max_amount")(e.target.value)} className="mt-1.5 num" /></div>
            </>
          )}
        </div>
        {(filters.entity === "invoices" || filters.entity === "quotes") && (
          <div className="grid md:grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Estado</Label>
              <Select value={filters.status} onValueChange={upd("status")}>
                <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="borrador">Borrador</SelectItem>
                  <SelectItem value="pendiente">Pendiente</SelectItem>
                  <SelectItem value="pagada">Pagada</SelectItem>
                  <SelectItem value="vencida">Vencida</SelectItem>
                  <SelectItem value="aceptado">Aceptado</SelectItem>
                  <SelectItem value="rechazado">Rechazado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Etiqueta</Label><Input value={filters.tag} onChange={(e) => upd("tag")(e.target.value)} className="mt-1.5" /></div>
          </div>
        )}
        <Button onClick={run} disabled={loading} data-testid="adv-run">
          <Filter className="h-4 w-4 mr-1.5" />{loading ? "Buscando..." : "Buscar"}
        </Button>
      </Card>

      {data && (
        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex justify-between items-center">
            <h3 className="font-heading font-semibold">{data.count} resultados</h3>
          </div>
          {data.count === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground">Sin resultados</div>
          ) : (
            <div className="divide-y divide-border">
              {data.items.map((it, i) => {
                const r = renderRow(it);
                return (
                  <div key={it.id || i} className="px-4 py-3 grid grid-cols-12 gap-3 hover:bg-muted/40">
                    <div className="col-span-6 text-sm font-medium truncate">{r.left}</div>
                    <div className="col-span-3 text-xs text-muted-foreground">{r.mid}</div>
                    <div className="col-span-3 text-sm num text-right">{r.right}</div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
