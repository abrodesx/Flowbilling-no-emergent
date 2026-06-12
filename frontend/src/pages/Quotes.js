import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, fmtEUR, fmtDate, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Plus, MoreHorizontal, Download, Trash2, FileSignature, Search, ArrowRightLeft, CheckCircle2, XCircle, Share2 } from "lucide-react";
import { toast } from "sonner";

const STATUS_STYLES = {
  aceptado: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  pendiente: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  rechazado: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
};

export default function Quotes() {
  const [items, setItems] = useState(null);
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const navigate = useNavigate();

  const load = useCallback(async () => {
    try {
      const params = filter !== "all" ? `?status=${filter}` : "";
      const { data } = await api.get(`/quotes${params}`);
      setItems(data);
    } catch (e) { toast.error(formatApiError(e)); }
  }, [filter]);
  useEffect(() => { load(); }, [load]);

  const downloadPDF = async (id, number) => {
    try {
      const res = await api.get(`/quotes/${id}/pdf`, { responseType: "blob" });
      const url = window.URL.createObjectURL(res.data);
      const a = document.createElement("a"); a.href = url; a.download = `presupuesto-${number}.pdf`; a.click();
      window.URL.revokeObjectURL(url);
    } catch (e) { toast.error("Error generando PDF"); }
  };

  const remove = async (id) => {
    if (!window.confirm("¿Eliminar presupuesto?")) return;
    try { await api.delete(`/quotes/${id}`); toast.success("Presupuesto eliminado"); load(); }
    catch (e) { toast.error(formatApiError(e)); }
  };

  const setStatus = async (q_, status) => {
    try { await api.put(`/quotes/${q_.id}`, { ...q_, status }); toast.success(`Marcado como ${status}`); load(); }
    catch (e) { toast.error(formatApiError(e)); }
  };

  const convert = async (id) => {
    if (!window.confirm("¿Convertir presupuesto en factura? Se generará una nueva factura con los mismos conceptos.")) return;
    try {
      const { data } = await api.post(`/quotes/${id}/convert`);
      toast.success(`Factura ${data.number} creada`);
      load();
      navigate(`/app/facturas/${data.id}`);
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const share = async (id) => {
    try {
      const { data } = await api.post(`/quotes/${id}/share`);
      const url = `${window.location.origin}/public/quote/${data.token}`;
      await navigator.clipboard.writeText(url).catch(() => {});
      toast.success("Enlace copiado al portapapeles", { description: url, duration: 6000 });
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const filtered = items?.filter((i) => !q || i.number.toLowerCase().includes(q.toLowerCase()) || i.client_name?.toLowerCase().includes(q.toLowerCase())) || [];

  return (
    <div className="space-y-6" data-testid="quotes-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-3xl font-bold">Presupuestos</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Crea y convierte a factura cuando se acepte</p>
        </div>
        <Link to="/app/presupuestos/nuevo"><Button data-testid="new-quote-button"><Plus className="h-4 w-4 mr-1" />Nuevo presupuesto</Button></Link>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <Tabs value={filter} onValueChange={setFilter}>
          <TabsList>
            <TabsTrigger value="all">Todos</TabsTrigger>
            <TabsTrigger value="pendiente">Pendientes</TabsTrigger>
            <TabsTrigger value="aceptado">Aceptados</TabsTrigger>
            <TabsTrigger value="rechazado">Rechazados</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative flex-1 max-w-xs ml-auto">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar..." value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
        </div>
      </div>

      <Card>
        {!items ? (
          <div className="p-6 space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-12" />)}</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <FileSignature className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground mb-4">Aún no tienes presupuestos.</p>
            <Link to="/app/presupuestos/nuevo"><Button size="sm">Crear primer presupuesto</Button></Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr className="text-left text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Número</th>
                  <th className="px-4 py-3 font-medium">Cliente</th>
                  <th className="px-4 py-3 font-medium">Fecha</th>
                  <th className="px-4 py-3 font-medium">Válido hasta</th>
                  <th className="px-4 py-3 font-medium text-right">Total</th>
                  <th className="px-4 py-3 font-medium">Estado</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((i) => (
                  <tr key={i.id} className="border-t border-border hover:bg-muted/30">
                    <td className="px-4 py-3 num font-semibold">
                      <Link to={`/app/presupuestos/${i.id}`} className="hover:text-primary">{i.number}</Link>
                      {i.converted_invoice_id && <span className="ml-2 text-[10px] uppercase px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600">→ Facturado</span>}
                    </td>
                    <td className="px-4 py-3">{i.client_name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{fmtDate(i.issue_date)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{i.valid_until ? fmtDate(i.valid_until) : "—"}</td>
                    <td className="px-4 py-3 num text-right font-semibold">{fmtEUR(i.total)}</td>
                    <td className="px-4 py-3"><Badge variant="outline" className={STATUS_STYLES[i.status]}>{i.status}</Badge></td>
                    <td className="px-4 py-3">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8" data-testid={`quote-menu-${i.id}`}><MoreHorizontal className="h-4 w-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => downloadPDF(i.id, i.number)}><Download className="h-4 w-4 mr-2" />Descargar PDF</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => share(i.id)}><Share2 className="h-4 w-4 mr-2" />Enlace público</DropdownMenuItem>
                          {!i.converted_invoice_id && <DropdownMenuItem onClick={() => convert(i.id)}><ArrowRightLeft className="h-4 w-4 mr-2" />Convertir a factura</DropdownMenuItem>}
                          {i.status !== "aceptado" && <DropdownMenuItem onClick={() => setStatus(i, "aceptado")}><CheckCircle2 className="h-4 w-4 mr-2" />Marcar aceptado</DropdownMenuItem>}
                          {i.status !== "rechazado" && <DropdownMenuItem onClick={() => setStatus(i, "rechazado")}><XCircle className="h-4 w-4 mr-2" />Marcar rechazado</DropdownMenuItem>}
                          <DropdownMenuItem onClick={() => remove(i.id)} className="text-destructive"><Trash2 className="h-4 w-4 mr-2" />Eliminar</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
