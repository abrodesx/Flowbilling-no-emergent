import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useProfile } from "@/contexts/ProfileContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ShieldCheck, Upload, Trash2, FileSignature, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

export default function DigitalSignature() {
  const { active } = useProfile() || {};
  const [info, setInfo] = useState(null);
  const [file, setFile] = useState(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!active?.id) return;
    const { data } = await api.get(`/profiles/${active.id}/certificate`);
    setInfo(data);
  }, [active?.id]);
  useEffect(() => { load(); }, [load]);

  const upload = async () => {
    if (!file) return toast.error("Selecciona un fichero .p12 o .pfx");
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("password", password);
      await api.post(`/profiles/${active.id}/certificate`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success("Certificado guardado correctamente");
      setFile(null); setPassword(""); load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Error subiendo certificado"); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    if (!window.confirm("¿Eliminar el certificado guardado?")) return;
    await api.delete(`/profiles/${active.id}/certificate`);
    toast.success("Certificado eliminado");
    load();
  };

  return (
    <div className="space-y-6" data-testid="signature-page">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-md bg-primary/10 text-primary flex items-center justify-center"><FileSignature className="h-5 w-5" /></div>
        <div>
          <h1 className="font-heading text-3xl font-bold">Firma digital</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Firma tus facturas electrónicamente con tu certificado FNMT/DNIe (PAdES) o con sello visual.</p>
        </div>
      </div>

      <Card className="p-4 bg-primary/5 border-primary/20 text-sm space-y-1">
        <p><b>Dos modos disponibles:</b></p>
        <ul className="list-disc list-inside text-muted-foreground space-y-0.5">
          <li><b>Cripto (PAdES)</b>: firma digital real con tu certificado. Verifica autenticidad e integridad. Acepta peritaje en juicio.</li>
          <li><b>Visual</b>: añade un sello con nombre, fecha y hash. No requiere certificado. Útil para uso interno.</li>
        </ul>
      </Card>

      <Card className="p-5 space-y-4">
        <h2 className="font-heading font-semibold flex items-center gap-2"><ShieldCheck className="h-4 w-4" />Certificado .p12 / .pfx</h2>
        {info?.has_certificate ? (
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              <div>
                <div className="font-semibold">{info.filename}</div>
                <div className="text-xs text-muted-foreground">Subido: {info.uploaded_at && new Date(info.uploaded_at).toLocaleString("es-ES")}</div>
              </div>
            </div>
            <Button onClick={remove} variant="ghost" size="sm" className="text-destructive" data-testid="remove-cert"><Trash2 className="h-4 w-4 mr-1.5" />Eliminar</Button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Sube tu certificado FNMT/DNIe en formato <code>.p12</code> o <code>.pfx</code>.
              Puedes obtenerlo en <a href="https://www.sede.fnmt.gob.es" target="_blank" rel="noopener noreferrer" className="text-primary underline">sede.fnmt.gob.es</a>.
            </p>
            <div>
              <Label className="text-xs">Fichero (.p12/.pfx)</Label>
              <input type="file" accept=".p12,.pfx" onChange={(e) => setFile(e.target.files?.[0])} data-testid="cert-file"
                className="mt-1.5 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary/10 file:text-primary file:px-3 file:py-1.5 file:text-xs file:font-semibold" />
            </div>
            <div>
              <Label className="text-xs">Contraseña del certificado</Label>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1.5" data-testid="cert-pwd" />
            </div>
            <Button onClick={upload} disabled={busy || !file} data-testid="upload-cert"><Upload className="h-4 w-4 mr-1.5" />Subir certificado</Button>
            <p className="text-[11px] text-muted-foreground">🔒 El certificado se almacena cifrado solo accesible por ti. Recomendado en producción usar KMS externo.</p>
          </div>
        )}
      </Card>

      <Card className="p-5 space-y-2">
        <h2 className="font-heading font-semibold">¿Cómo firmar una factura?</h2>
        <ol className="list-decimal list-inside text-sm text-muted-foreground space-y-1">
          <li>Ve a <b>Facturas</b> y abre cualquier factura.</li>
          <li>En el menú PDF, selecciona <b>"Descargar firmada · Visual"</b> o <b>"Descargar firmada · Cripto"</b>.</li>
          <li>El modo cripto requiere certificado subido aquí. El modo visual funciona siempre.</li>
        </ol>
      </Card>
    </div>
  );
}
