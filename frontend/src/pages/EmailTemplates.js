import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Mail, Save, Eye, Sparkles } from "lucide-react";
import { toast } from "sonner";

const TYPE_LABEL = {
  invoice_new: "Factura nueva",
  reminder: "Recordatorio de pago",
  quote_sent: "Presupuesto enviado",
  thanks_paid: "Agradecimiento por pago",
};

const SAMPLE_VARS = {
  cliente: "Acme S.L.", numero: "A-2026-0042", importe: "1.250,00 €",
  fecha: "21/02/2026", vencimiento: "21/03/2026", emisor: "Mi Empresa",
};

export default function EmailTemplates() {
  const [items, setItems] = useState(null);
  const [edit, setEdit] = useState(null);
  const [preview, setPreview] = useState(null);

  const load = async () => {
    const { data } = await api.get("/email-templates");
    setItems(data);
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    try {
      const payload = { type: edit.type, name: edit.name, subject: edit.subject, body: edit.body };
      if (edit.is_default || !edit.id || edit.id.startsWith("default-")) {
        await api.post("/email-templates", payload);
      } else {
        await api.put(`/email-templates/${edit.id}`, payload);
      }
      toast.success("Plantilla guardada");
      setEdit(null); load();
    } catch (e) { toast.error("Error guardando"); }
  };

  const showPreview = async () => {
    try {
      const { data } = await api.post("/email-templates/preview", {
        subject: edit.subject, body: edit.body, vars: SAMPLE_VARS,
      });
      setPreview(data);
    } catch (e) { toast.error("Error en previsualizacion"); }
  };

  return (
    <div className="space-y-6" data-testid="email-templates-page">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-md bg-primary/10 text-primary flex items-center justify-center"><Mail className="h-5 w-5" /></div>
        <div>
          <h1 className="font-heading text-3xl font-bold">Plantillas de email</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Personaliza los mensajes que envías a tus clientes con variables dinámicas.</p>
        </div>
      </div>

      <Card className="p-3 bg-primary/5 border-primary/20 text-xs">
        <b>Variables disponibles:</b> {Object.keys(SAMPLE_VARS).map(v => <code key={v} className="mx-1 px-1 py-0.5 rounded bg-background border">{`{{${v}}}`}</code>)}
      </Card>

      {!items ? (
        <div className="space-y-2">{[1,2,3,4].map(i => <Skeleton key={i} className="h-24" />)}</div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {items.map(t => (
            <Card key={t.id} className="p-5 space-y-2">
              <div className="flex justify-between items-start gap-2">
                <div>
                  <div className="font-semibold">{TYPE_LABEL[t.type] || t.name}</div>
                  <div className="text-xs text-muted-foreground">{t.is_default ? "Plantilla por defecto" : "Personalizada"}</div>
                </div>
                <Button size="sm" variant="outline" onClick={() => setEdit({...t})} data-testid={`edit-${t.type}`}>Editar</Button>
              </div>
              <div className="text-xs"><b>Asunto:</b> <span className="text-muted-foreground">{t.subject}</span></div>
              <div className="text-xs text-muted-foreground line-clamp-3 whitespace-pre-wrap">{t.body}</div>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{edit && (TYPE_LABEL[edit.type] || "Plantilla")}</DialogTitle></DialogHeader>
          {edit && (
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Nombre interno</Label>
                <Input value={edit.name} onChange={(e) => setEdit({...edit, name: e.target.value})} className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">Asunto</Label>
                <Input value={edit.subject} onChange={(e) => setEdit({...edit, subject: e.target.value})} className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">Cuerpo</Label>
                <Textarea value={edit.body} onChange={(e) => setEdit({...edit, body: e.target.value})} className="mt-1 min-h-[200px] font-mono text-sm" />
              </div>
              <div className="flex gap-2">
                <Button onClick={save} data-testid="save-template"><Save className="h-4 w-4 mr-1.5" />Guardar</Button>
                <Button variant="outline" onClick={showPreview}><Eye className="h-4 w-4 mr-1.5" />Previsualizar</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4" />Previsualización</DialogTitle></DialogHeader>
          {preview && (
            <div className="space-y-3 text-sm">
              <div className="px-3 py-2 bg-muted rounded"><b>Asunto:</b> {preview.subject}</div>
              <div className="px-3 py-3 bg-background border border-border rounded whitespace-pre-wrap">{preview.body}</div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
