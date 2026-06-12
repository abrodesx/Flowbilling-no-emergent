import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, fmtEUR, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, ArrowLeft, Save, Sparkles } from "lucide-react";
import { toast } from "sonner";

const newItem = () => ({ description: "", quantity: 1, price: 0, iva: 21, irpf: 0, discount: 0 });

export default function InvoiceEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEdit = Boolean(id);

  const [clients, setClients] = useState([]);
  const [form, setForm] = useState({
    client_id: "",
    series: "A",
    number: "",
    order_number: "",
    issue_date: new Date().toISOString().slice(0, 10),
    due_date: "",
    items: [newItem()],
    notes: "",
    status: "pendiente",
    recurring: "none",
    project_id: "",
    tags: [],
  });
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    api.get("/clients").then((r) => setClients(r.data));
    if (isEdit) {
      api.get(`/invoices/${id}`).then((r) => {
        const d = r.data;
        setForm({
          client_id: d.client_id, series: d.series, number: d.number || "", order_number: d.order_number || "",
          issue_date: d.issue_date,
          due_date: d.due_date || "", items: d.items, notes: d.notes || "",
          status: d.status, recurring: d.recurring || "none",
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
      sub += net;
      iva += net * ((it.iva || 0) / 100);
      irpf += net * ((it.irpf || 0) / 100);
    });
    return { sub, iva, irpf, total: sub + iva - irpf };
  }, [form.items]);

  const updItem = (i, k, v) => {
    const items = [...form.items];
    items[i] = { ...items[i], [k]: k === "description" ? v : Number(v) || 0 };
    setForm({ ...form, items });
  };

  const addItem = () => setForm({ ...form, items: [...form.items, newItem()] });
  const rmItem = (i) => setForm({ ...form, items: form.items.filter((_, idx) => idx !== i) });

  const aiConcept = async (i) => {
    const desc = form.items[i].description;
    if (!desc || desc.length < 5) return toast.error("Escribe una descripción breve primero (al menos 5 caracteres)");
    setAiLoading(true);
    try {
      const { data } = await api.post("/ai/generate-concept", { prompt: `Mejora este concepto de factura: "${desc}"` });
      updItem(i, "description", data.text);
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setAiLoading(false); }
  };

  const submit = async () => {
    if (!form.client_id) return toast.error("Selecciona un cliente");
    if (!form.items.length || form.items.some(i => !i.description)) return toast.error("Añade al menos un concepto con descripción");
    try {
      if (isEdit) {
        await api.put(`/invoices/${id}`, form);
        toast.success("Factura actualizada");
      } else {
        await api.post("/invoices", form);
        toast.success("Factura creada");
      }
      navigate("/app/facturas");
    } catch (e) { toast.error(formatApiError(e)); }
  };

  return (
    <div className="space-y-6" data-testid="invoice-editor">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/app/facturas")}><ArrowLeft className="h-4 w-4" /></Button>
          <div>
            <h1 className="font-heading text-3xl font-bold">{isEdit ? "Editar factura" : "Nueva factura"}</h1>
            <p className="text-sm text-muted-foreground">Rellena los datos de la factura</p>
          </div>
        </div>
        <Button onClick={submit} data-testid="save-invoice"><Save className="h-4 w-4 mr-1" />Guardar</Button>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 p-6 space-y-6">
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <Label>Cliente</Label>
              <Select value={form.client_id} onValueChange={(v) => setForm({ ...form, client_id: v })}>
                <SelectTrigger className="mt-1.5" data-testid="select-client"><SelectValue placeholder="Selecciona un cliente" /></SelectTrigger>
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
                  <SelectItem value="pagada">Pagada</SelectItem>
                  <SelectItem value="vencida">Vencida</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Serie</Label><Input value={form.series} onChange={(e) => setForm({ ...form, series: e.target.value })} className="mt-1.5" data-testid="series-input" /></div>
            <div>
              <Label>Número {!isEdit && <span className="text-xs text-muted-foreground">(opcional, auto si vacío)</span>}</Label>
              <Input value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} className="mt-1.5" placeholder="Auto-generado" data-testid="number-input" />
            </div>
            <div>
              <Label>Recurrente</Label>
              <Select value={form.recurring} onValueChange={(v) => setForm({ ...form, recurring: v })}>
                <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No recurrente</SelectItem>
                  <SelectItem value="weekly">Semanal</SelectItem>
                  <SelectItem value="monthly">Mensual</SelectItem>
                  <SelectItem value="yearly">Anual</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Fecha emisión</Label><Input type="date" value={form.issue_date} onChange={(e) => setForm({ ...form, issue_date: e.target.value })} className="mt-1.5" /></div>
            <div><Label>Vencimiento</Label><Input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} className="mt-1.5" /></div>
            <div>
              <Label>Nº Pedido <span className="text-xs text-muted-foreground">(opcional)</span></Label>
              <Input value={form.order_number} onChange={(e) => setForm({ ...form, order_number: e.target.value })} className="mt-1.5" placeholder="PO-2026-001" data-testid="order-number-input" />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <Label className="text-base">Conceptos</Label>
              <Button size="sm" variant="outline" onClick={addItem} data-testid="add-item"><Plus className="h-3.5 w-3.5 mr-1" />Añadir</Button>
            </div>
            <div className="space-y-3">
              {form.items.map((it, i) => (
                <div key={i} className="border border-border rounded-md p-3 space-y-2">
                  <div className="flex gap-2">
                    <Textarea placeholder="Descripción del servicio o producto" value={it.description} onChange={(e) => updItem(i, "description", e.target.value)} className="flex-1 min-h-[60px]" />
                    <Button size="icon" variant="outline" onClick={() => aiConcept(i)} disabled={aiLoading} title="Mejorar con IA"><Sparkles className="h-3.5 w-3.5" /></Button>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
                    <div><Label className="text-xs">Cant.</Label><Input type="number" value={it.quantity} onChange={(e) => updItem(i, "quantity", e.target.value)} className="num" /></div>
                    <div><Label className="text-xs">Precio €</Label><Input type="number" step="0.01" value={it.price} onChange={(e) => updItem(i, "price", e.target.value)} className="num" /></div>
                    <div><Label className="text-xs">IVA %</Label><Input type="number" value={it.iva} onChange={(e) => updItem(i, "iva", e.target.value)} className="num" /></div>
                    <div><Label className="text-xs">IRPF %</Label><Input type="number" value={it.irpf} onChange={(e) => updItem(i, "irpf", e.target.value)} className="num" /></div>
                    <div><Label className="text-xs">Desc. %</Label><Input type="number" value={it.discount} onChange={(e) => updItem(i, "discount", e.target.value)} className="num" /></div>
                    <div className="flex items-end">
                      <Button size="icon" variant="ghost" onClick={() => rmItem(i)} className="text-destructive"><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <Label>Observaciones</Label>
            <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="mt-1.5" placeholder="Notas, condiciones de pago..." />
          </div>
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
