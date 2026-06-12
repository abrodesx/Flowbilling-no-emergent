import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, fmtEUR, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, ArrowLeft, Save, FileSignature } from "lucide-react";
import { toast } from "sonner";

const newItem = () => ({ description: "", quantity: 1, price: 0, iva: 21, irpf: 0, discount: 0 });

export default function QuoteEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEdit = Boolean(id);
  const [clients, setClients] = useState([]);
  const [form, setForm] = useState({
    client_id: "", issue_date: new Date().toISOString().slice(0, 10),
    valid_until: "", items: [newItem()], notes: "", status: "pendiente",
  });

  useEffect(() => {
    api.get("/clients").then((r) => setClients(r.data));
    if (isEdit) {
      api.get(`/quotes/${id}`).then((r) => {
        const d = r.data;
        setForm({
          client_id: d.client_id, issue_date: d.issue_date,
          valid_until: d.valid_until || "", items: d.items,
          notes: d.notes || "", status: d.status,
        });
      });
    }
  }, [id, isEdit]);

  const totals = useMemo(() => {
    let sub = 0, iva = 0, irpf = 0;
    form.items.forEach((it) => {
      const line = (it.quantity || 0) * (it.price || 0);
      const disc = line * ((it.discount || 0) / 100);
      const net = line - disc;
      sub += net; iva += net * ((it.iva || 0) / 100); irpf += net * ((it.irpf || 0) / 100);
    });
    return { sub, iva, irpf, total: sub + iva - irpf };
  }, [form.items]);

  const updItem = (i, k, v) => {
    const items = [...form.items];
    items[i] = { ...items[i], [k]: k === "description" ? v : Number(v) || 0 };
    setForm({ ...form, items });
  };

  const submit = async () => {
    if (!form.client_id) return toast.error("Selecciona un cliente");
    if (!form.items.length || form.items.some(i => !i.description)) return toast.error("Añade al menos un concepto");
    try {
      if (isEdit) await api.put(`/quotes/${id}`, form);
      else await api.post("/quotes", form);
      toast.success(isEdit ? "Presupuesto actualizado" : "Presupuesto creado");
      navigate("/app/presupuestos");
    } catch (e) { toast.error(formatApiError(e)); }
  };

  return (
    <div className="space-y-6" data-testid="quote-editor">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/app/presupuestos")}><ArrowLeft className="h-4 w-4" /></Button>
          <div>
            <h1 className="font-heading text-3xl font-bold">{isEdit ? "Editar presupuesto" : "Nuevo presupuesto"}</h1>
            <p className="text-sm text-muted-foreground">Crea un presupuesto que podrás convertir en factura</p>
          </div>
        </div>
        <div className="flex gap-2">
          {isEdit && (
            <Button variant="outline" onClick={async () => {
              try {
                const res = await api.get(`/quotes/${id}/contract.pdf`, { responseType: "blob" });
                const url = window.URL.createObjectURL(res.data);
                const a = document.createElement("a"); a.href = url; a.download = `contrato-${id}.pdf`; a.click();
                window.URL.revokeObjectURL(url);
              } catch (e) { toast.error("Error generando contrato"); }
            }} data-testid="generate-contract"><FileSignature className="h-4 w-4 mr-1" />Generar contrato</Button>
          )}
          <Button onClick={submit} data-testid="save-quote"><Save className="h-4 w-4 mr-1" />Guardar</Button>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 p-6 space-y-6">
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <Label>Cliente</Label>
              <Select value={form.client_id} onValueChange={(v) => setForm({ ...form, client_id: v })}>
                <SelectTrigger className="mt-1.5"><SelectValue placeholder="Selecciona un cliente" /></SelectTrigger>
                <SelectContent>
                  {clients.length === 0 && <div className="px-3 py-2 text-sm text-muted-foreground">Crea un cliente primero</div>}
                  {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}{c.company ? ` · ${c.company}` : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Estado</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pendiente">Pendiente</SelectItem>
                  <SelectItem value="aceptado">Aceptado</SelectItem>
                  <SelectItem value="rechazado">Rechazado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Fecha emisión</Label><Input type="date" value={form.issue_date} onChange={(e) => setForm({ ...form, issue_date: e.target.value })} className="mt-1.5" /></div>
            <div><Label>Válido hasta</Label><Input type="date" value={form.valid_until} onChange={(e) => setForm({ ...form, valid_until: e.target.value })} className="mt-1.5" /></div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <Label className="text-base">Conceptos</Label>
              <Button size="sm" variant="outline" onClick={() => setForm({ ...form, items: [...form.items, newItem()] })}><Plus className="h-3.5 w-3.5 mr-1" />Añadir</Button>
            </div>
            <div className="space-y-3">
              {form.items.map((it, i) => (
                <div key={i} className="border border-border rounded-md p-3 space-y-2">
                  <Textarea placeholder="Descripción del servicio o producto" value={it.description} onChange={(e) => updItem(i, "description", e.target.value)} className="min-h-[60px]" />
                  <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
                    <div><Label className="text-xs">Cant.</Label><Input type="number" value={it.quantity} onChange={(e) => updItem(i, "quantity", e.target.value)} className="num" /></div>
                    <div><Label className="text-xs">Precio €</Label><Input type="number" step="0.01" value={it.price} onChange={(e) => updItem(i, "price", e.target.value)} className="num" /></div>
                    <div><Label className="text-xs">IVA %</Label><Input type="number" value={it.iva} onChange={(e) => updItem(i, "iva", e.target.value)} className="num" /></div>
                    <div><Label className="text-xs">IRPF %</Label><Input type="number" value={it.irpf} onChange={(e) => updItem(i, "irpf", e.target.value)} className="num" /></div>
                    <div><Label className="text-xs">Desc. %</Label><Input type="number" value={it.discount} onChange={(e) => updItem(i, "discount", e.target.value)} className="num" /></div>
                    <div className="flex items-end">
                      <Button size="icon" variant="ghost" onClick={() => setForm({ ...form, items: form.items.filter((_, idx) => idx !== i) })} className="text-destructive"><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div><Label>Observaciones</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="mt-1.5" placeholder="Condiciones, plazos, validez..." /></div>
        </Card>

        <Card className="p-6 h-fit sticky top-20">
          <h3 className="font-heading font-semibold text-lg mb-4">Resumen</h3>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="num font-medium">{fmtEUR(totals.sub)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">IVA</span><span className="num font-medium">{fmtEUR(totals.iva)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">IRPF</span><span className="num font-medium text-destructive">-{fmtEUR(totals.irpf)}</span></div>
            <div className="border-t border-border pt-3 flex justify-between text-base"><span className="font-semibold">Total</span><span className="num font-bold text-primary text-xl">{fmtEUR(totals.total)}</span></div>
          </div>
        </Card>
      </div>
    </div>
  );
}
