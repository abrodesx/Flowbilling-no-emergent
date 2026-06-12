import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, fmtEUR } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Sparkles, Upload, Save, RotateCcw, FileText } from "lucide-react";
import { toast } from "sonner";

export default function AIImport() {
  const navigate = useNavigate();
  const [target, setTarget] = useState("invoice");
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState(null);

  const analyze = async () => {
    if (!file) return toast.error("Selecciona un fichero primero");
    setLoading(true); setPreview(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("target", target);
      fd.append("save", "false");
      const { data } = await api.post("/ai/import-invoice", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setPreview(data.preview);
      toast.success("Documento analizado. Revisa y guarda.");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Error analizando documento");
    } finally { setLoading(false); }
  };

  const save = async () => {
    if (!file || !preview) return;
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("target", target);
      fd.append("save", "true");
      const { data } = await api.post("/ai/import-invoice", fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success(`${target === "invoice" ? "Factura" : "Presupuesto"} ${data.number} importado`);
      navigate(target === "invoice" ? `/app/facturas/${data.id}` : `/app/presupuestos/${data.id}`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Error guardando");
    } finally { setLoading(false); }
  };

  const updField = (k, v) => setPreview({ ...preview, [k]: v });
  const updItem = (i, k, v) => {
    const items = [...preview.items];
    items[i] = { ...items[i], [k]: k === "description" ? v : Number(v) || 0 };
    setPreview({ ...preview, items });
  };

  return (
    <div className="space-y-6" data-testid="ai-import-page">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-md bg-primary/10 text-primary flex items-center justify-center"><Sparkles className="h-5 w-5" /></div>
        <div>
          <h1 className="font-heading text-3xl font-bold">Importar con IA</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Sube una factura o presupuesto en PDF/imagen y la IA extraerá automáticamente los datos.</p>
        </div>
      </div>

      <Card className="p-5 space-y-4">
        <Tabs value={target} onValueChange={(v) => { setTarget(v); setPreview(null); }}>
          <TabsList>
            <TabsTrigger value="invoice" data-testid="tab-invoice">Factura</TabsTrigger>
            <TabsTrigger value="quote" data-testid="tab-quote">Presupuesto</TabsTrigger>
          </TabsList>
          <TabsContent value="invoice" />
          <TabsContent value="quote" />
        </Tabs>
        <div>
          <Label className="text-xs">Documento (PDF, PNG o JPG, máx 10MB)</Label>
          <input type="file" accept=".pdf,image/png,image/jpeg,image/webp" data-testid="ai-import-file"
            onChange={(e) => { setFile(e.target.files?.[0]); setPreview(null); }}
            className="mt-1.5 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary/10 file:text-primary file:px-3 file:py-1.5 file:text-xs file:font-semibold" />
        </div>
        <Button onClick={analyze} disabled={!file || loading} data-testid="ai-analyze-btn">
          <Sparkles className="h-4 w-4 mr-1.5" />{loading ? "Analizando..." : "Analizar con IA"}
        </Button>
      </Card>

      {preview && (
        <Card className="p-5 space-y-4" data-testid="ai-preview-card">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2"><FileText className="h-5 w-5 text-emerald-600" /><h2 className="font-heading font-semibold">Datos extraídos · Revisa antes de guardar</h2></div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setPreview(null)}><RotateCcw className="h-4 w-4 mr-1.5" />Descartar</Button>
              <Button size="sm" onClick={save} disabled={loading} data-testid="ai-save-btn"><Save className="h-4 w-4 mr-1.5" />Guardar {target === "invoice" ? "factura" : "presupuesto"}</Button>
            </div>
          </div>
          <div className="grid md:grid-cols-4 gap-3">
            <div><Label className="text-xs">Serie</Label><Input value={preview.series} onChange={(e) => updField("series", e.target.value)} className="mt-1" /></div>
            <div><Label className="text-xs">Número</Label><Input value={preview.number} onChange={(e) => updField("number", e.target.value)} placeholder="Auto si vacío" className="mt-1" /></div>
            <div><Label className="text-xs">Fecha</Label><Input type="date" value={preview.issue_date} onChange={(e) => updField("issue_date", e.target.value)} className="mt-1" /></div>
            <div><Label className="text-xs">{target === "invoice" ? "Vencimiento" : "Válido hasta"}</Label><Input type="date" value={preview.due_date} onChange={(e) => updField("due_date", e.target.value)} className="mt-1" /></div>
          </div>
          {target === "invoice" && (
            <div className="grid md:grid-cols-2 gap-3">
              <div><Label className="text-xs">Nº Pedido</Label><Input value={preview.order_number} onChange={(e) => updField("order_number", e.target.value)} className="mt-1" /></div>
            </div>
          )}
          <div className="grid md:grid-cols-2 gap-3">
            <div><Label className="text-xs">Cliente</Label><Input value={preview.client_name} onChange={(e) => updField("client_name", e.target.value)} className="mt-1" /></div>
            <div><Label className="text-xs">NIF cliente</Label><Input value={preview.client_nif} onChange={(e) => updField("client_nif", e.target.value)} className="mt-1" /></div>
            <div className="md:col-span-2"><Label className="text-xs">Dirección</Label><Input value={preview.client_address} onChange={(e) => updField("client_address", e.target.value)} className="mt-1" /></div>
          </div>
          <div>
            <Label className="text-xs">Conceptos</Label>
            <div className="border border-border rounded-md overflow-hidden mt-1">
              <div className="grid grid-cols-12 gap-2 text-[11px] uppercase text-muted-foreground bg-muted/40 px-2 py-2 font-semibold">
                <div className="col-span-5">Descripción</div>
                <div className="col-span-1 text-right">Cant.</div>
                <div className="col-span-2 text-right">Precio</div>
                <div className="col-span-1 text-right">IVA%</div>
                <div className="col-span-1 text-right">IRPF%</div>
                <div className="col-span-2 text-right">Total</div>
              </div>
              {preview.items.map((it, i) => {
                const line = (it.quantity || 0) * (it.price || 0) * (1 - (it.discount || 0) / 100);
                return (
                  <div key={i} className="grid grid-cols-12 gap-2 px-2 py-2 border-t border-border items-center">
                    <Input className="col-span-5 h-8" value={it.description} onChange={(e) => updItem(i, "description", e.target.value)} />
                    <Input type="number" className="col-span-1 h-8 num text-right" value={it.quantity} onChange={(e) => updItem(i, "quantity", e.target.value)} />
                    <Input type="number" className="col-span-2 h-8 num text-right" value={it.price} onChange={(e) => updItem(i, "price", e.target.value)} />
                    <Input type="number" className="col-span-1 h-8 num text-right" value={it.iva} onChange={(e) => updItem(i, "iva", e.target.value)} />
                    <Input type="number" className="col-span-1 h-8 num text-right" value={it.irpf} onChange={(e) => updItem(i, "irpf", e.target.value)} />
                    <div className="col-span-2 num text-right text-sm font-medium">{fmtEUR(line)}</div>
                  </div>
                );
              })}
            </div>
          </div>
          {preview.notes && (
            <div><Label className="text-xs">Observaciones</Label><Input value={preview.notes} onChange={(e) => updField("notes", e.target.value)} className="mt-1" /></div>
          )}
          <p className="text-[11px] text-muted-foreground">🤖 Datos extraídos por IA. Verifica antes de guardar. Si el cliente no existe en tu base, se creará automáticamente.</p>
        </Card>
      )}
    </div>
  );
}
