import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, fmtEUR, fmtDate, formatApiError, API_BASE } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Plus, MoreHorizontal, Download, Copy, Trash2, FileText, Search, CheckCircle2, FileMinus, Wallet, ShieldCheck, Mail } from "lucide-react";
import { toast } from "sonner";
import PaymentsDialog from "@/components/PaymentsDialog";

const STATUS_STYLES = {
  pagada: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  pendiente: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  vencida: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
};

export default function Invoices() {
  const [items, setItems] = useState(null);
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    try {
      const params = filter !== "all" ? `?status=${filter}` : "";
      const { data } = await api.get(`/invoices${params}`);
      setItems(data);
    } catch (e) { toast.error(formatApiError(e)); }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const downloadPDF = async (id, number, showQr = true) => {
    try {
      const res = await api.get(`/invoices/${id}/pdf?show_qr=${showQr}`, { responseType: "blob" });
      const url = window.URL.createObjectURL(res.data);
      const a = document.createElement("a"); a.href = url; a.download = `factura-${number}.pdf`; a.click();
      window.URL.revokeObjectURL(url);
    } catch (e) { toast.error("Error generando PDF"); }
  };

  const duplicate = async (id) => {
    try { await api.post(`/invoices/${id}/duplicate`); toast.success("Factura duplicada"); load(); }
    catch (e) { toast.error(formatApiError(e)); }
  };

  const remove = async (id) => {
    try { await api.delete(`/invoices/${id}`); toast.success("Factura eliminada"); load(); }
    catch (e) { toast.error(formatApiError(e)); }
  };

  const markPaid = async (inv) => {
    try {
      await api.put(`/invoices/${inv.id}`, { ...inv, status: "pagada" });
      toast.success("Factura marcada como pagada"); load();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const rectify = async (id) => {
    if (!window.confirm("¿Crear factura rectificativa (abono)? Se generará una nueva factura enlazada.")) return;
    try { const { data } = await api.post(`/invoices/${id}/rectify`); toast.success(`Rectificativa ${data.number} creada`); load(); }
    catch (e) { toast.error(formatApiError(e)); }
  };

  const signVerifactu = async (id) => {
    try { await api.post(`/invoices/${id}/verifactu`); toast.success("Factura firmada con Verifactu QR"); load(); }
    catch (e) { toast.error(formatApiError(e)); }
  };

  const sendEmail = async (inv) => {
    const to = window.prompt(`Enviar factura ${inv.number} a:`, inv.client_email || "");
    if (!to) return;
    try { await api.post("/emails/send-invoice", { invoice_id: inv.id, to_email: to }); toast.success(`Email enviado a ${to}`); }
    catch (e) { toast.error(formatApiError(e)); }
  };

  const filtered = items?.filter((i) => !q || i.number.toLowerCase().includes(q.toLowerCase()) || i.client_name?.toLowerCase().includes(q.toLowerCase())) || [];

  return (
    <div className="space-y-6" data-testid="invoices-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-3xl font-bold">Facturas</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Gestiona y exporta tus facturas</p>
        </div>
        <Link to="/app/facturas/nueva"><Button data-testid="new-invoice-button"><Plus className="h-4 w-4 mr-1" />Nueva factura</Button></Link>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <Tabs value={filter} onValueChange={setFilter}>
          <TabsList>
            <TabsTrigger value="all" data-testid="filter-all">Todas</TabsTrigger>
            <TabsTrigger value="pendiente" data-testid="filter-pending">Pendientes</TabsTrigger>
            <TabsTrigger value="pagada" data-testid="filter-paid">Pagadas</TabsTrigger>
            <TabsTrigger value="vencida" data-testid="filter-overdue">Vencidas</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative flex-1 max-w-xs ml-auto">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar..." value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" data-testid="invoice-search" />
        </div>
      </div>

      <Card>
        {!items ? (
          <div className="p-6 space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-12" />)}</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <FileText className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground mb-4">No hay facturas.</p>
            <Link to="/app/facturas/nueva"><Button size="sm">Crear factura</Button></Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr className="text-left text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Número</th>
                  <th className="px-4 py-3 font-medium">Cliente</th>
                  <th className="px-4 py-3 font-medium">Fecha</th>
                  <th className="px-4 py-3 font-medium">Vencimiento</th>
                  <th className="px-4 py-3 font-medium text-right">Total</th>
                  <th className="px-4 py-3 font-medium">Estado</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((i) => (
                  <tr key={i.id} className="border-t border-border hover:bg-muted/30">
                    <td className="px-4 py-3 num font-semibold">
                      <Link to={`/app/facturas/${i.id}`} className="hover:text-primary">{i.number}</Link>
                      {i.type === "rectificativa" && <span className="ml-2 text-[10px] uppercase px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600">Rect.</span>}
                      {i.type === "abono" && <span className="ml-2 text-[10px] uppercase px-1.5 py-0.5 rounded bg-red-500/10 text-red-600">Abono</span>}
                    </td>
                    <td className="px-4 py-3">{i.client_name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{fmtDate(i.issue_date)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{i.due_date ? fmtDate(i.due_date) : "—"}</td>
                    <td className="px-4 py-3 num text-right">
                      <div className="font-semibold">{fmtEUR(i.total)}</div>
                      {i.paid_amount > 0 && i.paid_amount < i.total && (
                        <div className="text-[11px] text-emerald-600">{fmtEUR(i.paid_amount)} cobrado</div>
                      )}
                    </td>
                    <td className="px-4 py-3"><Badge variant="outline" className={STATUS_STYLES[i.status]}>{i.status}</Badge></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        <PaymentsDialog invoice={i} onChange={load} trigger={<Button size="icon" variant="ghost" className="h-8 w-8" title="Cobros" data-testid={`payments-${i.id}`}><Wallet className="h-4 w-4" /></Button>} />
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8" data-testid={`invoice-menu-${i.id}`}><MoreHorizontal className="h-4 w-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => downloadPDF(i.id, i.number, true)}><Download className="h-4 w-4 mr-2" />Descargar PDF (con QR)</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => downloadPDF(i.id, i.number, false)}><Download className="h-4 w-4 mr-2" />Descargar PDF (sin QR)</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => sendEmail(i)}><Mail className="h-4 w-4 mr-2" />Enviar por email</DropdownMenuItem>
                            {!i.verifactu_uuid && <DropdownMenuItem onClick={() => signVerifactu(i.id)}><ShieldCheck className="h-4 w-4 mr-2" />Firmar Verifactu</DropdownMenuItem>}
                            <DropdownMenuItem onClick={() => duplicate(i.id)}><Copy className="h-4 w-4 mr-2" />Duplicar</DropdownMenuItem>
                            {i.type === "factura" && <DropdownMenuItem onClick={() => rectify(i.id)}><FileMinus className="h-4 w-4 mr-2" />Crear rectificativa</DropdownMenuItem>}
                            {i.status !== "pagada" && <DropdownMenuItem onClick={() => markPaid(i)}><CheckCircle2 className="h-4 w-4 mr-2" />Marcar pagada</DropdownMenuItem>}
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-destructive"><Trash2 className="h-4 w-4 mr-2" />Eliminar</DropdownMenuItem>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader><AlertDialogTitle>¿Eliminar factura?</AlertDialogTitle><AlertDialogDescription>Esta acción no se puede deshacer.</AlertDialogDescription></AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => remove(i.id)} className="bg-destructive text-destructive-foreground">Eliminar</AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
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
