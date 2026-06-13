import { useEffect, useRef, useState } from "react";
import { api, fmtEUR, fmtDate, formatApiError, API_BASE } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Receipt, Trash2, Sparkles, Upload, Pencil, Camera } from "lucide-react";
import { toast } from "sonner";

const compressImage = (file) =>
  new Promise((resolve) => {
    if (!/^image\//i.test(file.type)) {
      resolve(file);
      return;
    }

    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const maxSide = 1200;
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const width = Math.round(img.width * scale);
      const height = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(file);
            return;
          }
          resolve(new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" }));
        },
        "image/jpeg",
        0.72
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };
    img.src = url;
  });

const CATEGORIES = ["Material oficina", "Software", "Restauración", "Transporte", "Suministros", "Marketing", "Servicios profesionales", "Otros"];
const empty = { description: "", category: "Otros", amount: 0, iva: 21, date: new Date().toISOString().slice(0, 10), supplier: "", payment_method: "tarjeta", notes: "" };

export default function Expenses() {
  const [items, setItems] = useState(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const fileRef = useRef(null);
  const cameraRef = useRef(null);

  const load = async () => {
    try { const { data } = await api.get("/expenses"); setItems(data); }
    catch (e) { toast.error(formatApiError(e)); }
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.description || !form.amount) return toast.error("Descripción e importe son obligatorios");
    try {
      const payload = { ...form, amount: Number(form.amount), iva: Number(form.iva) };
      if (editing) await api.put(`/expenses/${editing}`, payload);
      else await api.post("/expenses", payload);
      toast.success("Gasto guardado");
      setOpen(false); setForm(empty); setEditing(null); load();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const remove = async (id) => {
    if (!window.confirm("¿Eliminar gasto?")) return;
    try { await api.delete(`/expenses/${id}`); toast.success("Gasto eliminado"); load(); }
    catch (e) { toast.error(formatApiError(e)); }
  };

  const onFile = async (file) => {
    if (!file) return;
    const ok = /^image\//i.test(file.type) || /pdf/i.test(file.type) || /\.pdf$/i.test(file.name);
    if (!ok) return toast.error("Sube una imagen o PDF");
    setOcrLoading(true);
    const fd = new FormData();
    try {
      const { data: aiStatus } = await api.get("/ai/config-status", { headers: { "Cache-Control": "no-cache" } });
      if (!aiStatus?.gemini_configured || aiStatus?.vision_primary !== "gemini") {
        return toast.error(`Gemini no está activo en ${API_BASE}`);
      }
      const uploadFile = await compressImage(file);
      fd.append("file", uploadFile, uploadFile.name || "ticket.jpg");
      const { data } = await api.post("/ai/ocr-receipt-gemini", fd);
      setForm({
        ...empty,
        description: data.description || "Ticket escaneado",
        amount: Number(data.amount) || 0,
        iva: data.iva != null ? Number(data.iva) : 21,
        date: data.date || empty.date,
        supplier: data.merchant || "",
        category: CATEGORIES.includes(data.category) ? data.category : "Otros",
      });
      setOpen(true);
      toast.success("Ticket analizado · revisa los datos");
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setOcrLoading(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  const onDrop = (e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); };

  return (
    <div className="space-y-6" data-testid="expenses-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-3xl font-bold">Gastos</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Sube tickets y deja que la IA los procese</p>
        </div>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setForm(empty); setEditing(null); } }}>
          <DialogTrigger asChild><Button data-testid="new-expense-button"><Plus className="h-4 w-4 mr-1" />Nuevo gasto</Button></DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>{editing ? "Editar gasto" : "Nuevo gasto"}</DialogTitle><DialogDescription>Introduce los datos del gasto</DialogDescription></DialogHeader>
            <div className="grid md:grid-cols-2 gap-3">
              <div className="md:col-span-2"><Label>Descripción *</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} data-testid="expense-description" /></div>
              <div><Label>Importe (con IVA) *</Label><Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="num" data-testid="expense-amount" /></div>
              <div><Label>IVA %</Label><Input type="number" value={form.iva} onChange={(e) => setForm({ ...form, iva: e.target.value })} className="num" /></div>
              <div><Label>Fecha</Label><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
              <div><Label>Proveedor</Label><Input value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} /></div>
              <div>
                <Label>Categoría</Label>
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Método de pago</Label>
                <Select value={form.payment_method} onValueChange={(v) => setForm({ ...form, payment_method: v })}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tarjeta">Tarjeta</SelectItem>
                    <SelectItem value="efectivo">Efectivo</SelectItem>
                    <SelectItem value="transferencia">Transferencia</SelectItem>
                    <SelectItem value="bizum">Bizum</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="md:col-span-2"><Label>Notas</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button onClick={save} data-testid="save-expense">Guardar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card
        className="p-8 border-dashed border-2 text-center hover:border-primary transition-colors"
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        data-testid="ocr-dropzone"
      >
        <input ref={fileRef} type="file" accept="image/*,application/pdf" hidden onChange={(e) => onFile(e.target.files?.[0])} />
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => onFile(e.target.files?.[0])} />
        <div className="h-12 w-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto mb-3">
          {ocrLoading ? <div className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin" /> : <Sparkles className="h-5 w-5" />}
        </div>
        <p className="font-semibold">{ocrLoading ? "Analizando con IA..." : "Subir ticket, factura o PDF"}</p>
        <p className="text-sm text-muted-foreground mt-1">La IA extraerá importe, IVA, comercio, fecha y categoría</p>
        <div className="flex flex-wrap justify-center gap-2 mt-4">
          <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); cameraRef.current?.click(); }} data-testid="btn-camera">
            <Camera className="h-3.5 w-3.5 mr-1" />Tomar foto
          </Button>
          <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); fileRef.current?.click(); }} data-testid="btn-upload">
            <Upload className="h-3.5 w-3.5 mr-1" />Subir archivo
          </Button>
        </div>
      </Card>

      {!items ? (
        <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-14" />)}</div>
      ) : items.length === 0 ? (
        <Card className="p-12 text-center">
          <Receipt className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">Aún no hay gastos registrados.</p>
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr className="text-left text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Descripción</th>
                  <th className="px-4 py-3 font-medium">Categoría</th>
                  <th className="px-4 py-3 font-medium">Proveedor</th>
                  <th className="px-4 py-3 font-medium">Fecha</th>
                  <th className="px-4 py-3 font-medium text-right">Importe</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((e) => (
                  <tr key={e.id} className="border-t border-border hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium">{e.description}</td>
                    <td className="px-4 py-3"><span className="text-xs px-2 py-0.5 rounded bg-muted">{e.category}</span></td>
                    <td className="px-4 py-3 text-muted-foreground">{e.supplier || "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{fmtDate(e.date)}</td>
                    <td className="px-4 py-3 num text-right font-semibold">{fmtEUR(e.amount)}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 justify-end">
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { setForm(e); setEditing(e.id); setOpen(true); }}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => remove(e.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
