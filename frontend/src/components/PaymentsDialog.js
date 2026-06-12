import { useCallback, useEffect, useState } from "react";
import { api, fmtEUR, fmtDate, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2, Wallet, History } from "lucide-react";
import { toast } from "sonner";

export default function PaymentsDialog({ invoice, onChange, trigger }) {
  const [open, setOpen] = useState(false);
  const [payments, setPayments] = useState([]);
  const [form, setForm] = useState({ amount: "", date: new Date().toISOString().slice(0, 10), method: "transferencia", notes: "" });

  const load = useCallback(async () => {
    if (!invoice) return;
    try {
      const { data } = await api.get(`/invoices/${invoice.id}/payments`);
      setPayments(data);
    } catch (e) { toast.error(formatApiError(e)); }
  }, [invoice]);

  useEffect(() => { if (open) load(); }, [open, load]);

  const add = async () => {
    if (!form.amount || Number(form.amount) <= 0) return toast.error("Importe inválido");
    try {
      await api.post(`/invoices/${invoice.id}/payments`, { ...form, amount: Number(form.amount) });
      toast.success("Pago registrado");
      setForm({ amount: "", date: new Date().toISOString().slice(0, 10), method: "transferencia", notes: "" });
      load(); onChange?.();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const remove = async (pid) => {
    if (!window.confirm("¿Eliminar este pago?")) return;
    try { await api.delete(`/payments/${pid}`); toast.success("Pago eliminado"); load(); onChange?.(); }
    catch (e) { toast.error(formatApiError(e)); }
  };

  const total = invoice?.total || 0;
  const paid = invoice?.paid_amount || 0;
  const pending = Math.max(0, total - paid);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger || <Button size="sm" variant="outline" data-testid="open-payments"><Wallet className="h-3.5 w-3.5 mr-1" />Pagos</Button>}</DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Cobros · {invoice?.number}</DialogTitle>
          <DialogDescription>Registra cobros parciales o totales</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="p-2 rounded bg-muted/40"><div className="text-[10px] uppercase text-muted-foreground">Total</div><div className="num font-semibold">{fmtEUR(total)}</div></div>
          <div className="p-2 rounded bg-emerald-500/10"><div className="text-[10px] uppercase text-muted-foreground">Cobrado</div><div className="num font-semibold text-emerald-600">{fmtEUR(paid)}</div></div>
          <div className="p-2 rounded bg-amber-500/10"><div className="text-[10px] uppercase text-muted-foreground">Pendiente</div><div className="num font-semibold text-amber-600">{fmtEUR(pending)}</div></div>
        </div>

        <div className="space-y-2 border-t pt-4">
          <h4 className="text-sm font-semibold">Nuevo cobro</h4>
          <div className="grid grid-cols-2 gap-2">
            <div><Label className="text-xs">Importe €</Label><Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="num" data-testid="payment-amount" /></div>
            <div><Label className="text-xs">Fecha</Label><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Método</Label>
              <Select value={form.method} onValueChange={(v) => setForm({ ...form, method: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="transferencia">Transferencia</SelectItem>
                  <SelectItem value="tarjeta">Tarjeta</SelectItem>
                  <SelectItem value="efectivo">Efectivo</SelectItem>
                  <SelectItem value="bizum">Bizum</SelectItem>
                  <SelectItem value="domiciliacion">Domiciliación</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Notas</Label><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
          <Button size="sm" onClick={add} className="w-full" data-testid="add-payment"><Plus className="h-3.5 w-3.5 mr-1" />Registrar cobro</Button>
        </div>

        <div className="border-t pt-4">
          <h4 className="text-sm font-semibold mb-2 flex items-center gap-2"><History className="h-4 w-4" />Historial</h4>
          {payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin pagos registrados.</p>
          ) : (
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {payments.map((p) => (
                <div key={p.id} className="flex items-center justify-between p-2 rounded bg-muted/40 text-sm">
                  <div>
                    <span className="num font-semibold">{fmtEUR(p.amount)}</span>
                    <span className="text-muted-foreground ml-2 text-xs">{fmtDate(p.date)} · {p.method}</span>
                    {p.notes && <div className="text-xs text-muted-foreground">{p.notes}</div>}
                  </div>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => remove(p.id)}><Trash2 className="h-3 w-3" /></Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
