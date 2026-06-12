import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useProfile } from "@/contexts/ProfileContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { UserCheck, Link2, Copy, Trash2, RefreshCw, Mail } from "lucide-react";
import { toast } from "sonner";

export default function Gestor() {
  const { active } = useProfile() || {};
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!active?.id) return;
    try {
      const { data } = await api.get(`/profiles/${active.id}/gestor-link`);
      setData(data);
    } catch (e) { setData({ token: "" }); }
  }, [active?.id]);
  useEffect(() => { load(); }, [load]);

  const generate = async () => {
    setLoading(true);
    try {
      const { data } = await api.post(`/profiles/${active.id}/gestor-link`);
      setData(data); toast.success("Enlace creado");
    } catch (e) { toast.error("Error generando enlace"); }
    finally { setLoading(false); }
  };

  const revoke = async () => {
    if (!window.confirm("¿Revocar el enlace? El gestor perderá el acceso.")) return;
    setLoading(true);
    try {
      await api.delete(`/profiles/${active.id}/gestor-link`);
      setData({ token: "" }); toast.success("Enlace revocado");
    } catch (e) { toast.error("Error"); }
    finally { setLoading(false); }
  };

  const fullUrl = data?.token ? `${window.location.origin}/gestor/${data.token}` : "";

  const copy = () => {
    navigator.clipboard.writeText(fullUrl);
    toast.success("Enlace copiado");
  };

  const emailLink = data?.token ? `mailto:?subject=Acceso%20al%20portal%20del%20gestor&body=Hola,%0A%0AAccede%20a%20mi%20contabilidad%20aqu%C3%AD:%20${encodeURIComponent(fullUrl)}%0A%0AGracias` : "";

  return (
    <div className="space-y-6" data-testid="gestor-page">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-md bg-primary/10 text-primary flex items-center justify-center"><UserCheck className="h-5 w-5" /></div>
        <div>
          <h1 className="font-heading text-3xl font-bold">Acceso para tu gestor</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Comparte un enlace único de solo lectura con tu asesor fiscal.</p>
        </div>
      </div>

      <Card className="p-4 bg-primary/5 border-primary/20 text-sm space-y-1">
        <p><b>¿Cómo funciona?</b></p>
        <ul className="list-disc list-inside text-muted-foreground space-y-0.5">
          <li>Genera un enlace privado por cada perfil/empresa que quieras compartir.</li>
          <li>Tu gestor verá <b>facturas, gastos y resúmenes anuales/trimestrales</b> en modo solo lectura, sin login.</li>
          <li>Puede descargar libros y modelos AEAT directamente.</li>
          <li>Puedes <b>revocar el acceso</b> en cualquier momento.</li>
        </ul>
      </Card>

      {!active ? (
        <Skeleton className="h-32" />
      ) : !data?.token ? (
        <Card className="p-8 text-center space-y-4">
          <p className="text-sm text-muted-foreground">No hay enlace activo para <b className="text-foreground">{active.name}</b></p>
          <Button onClick={generate} disabled={loading} data-testid="generate-link">
            <Link2 className="h-4 w-4 mr-1.5" />Generar enlace de gestor
          </Button>
        </Card>
      ) : (
        <Card className="p-5 space-y-4">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-1">Enlace activo para {active.name}</div>
            <div className="font-mono text-xs break-all p-3 bg-muted rounded" data-testid="gestor-url">{fullUrl}</div>
            {data.created_at && <div className="text-xs text-muted-foreground mt-1">Creado: {new Date(data.created_at).toLocaleString("es-ES")}</div>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={copy} size="sm"><Copy className="h-4 w-4 mr-1.5" />Copiar</Button>
            <Button asChild size="sm" variant="outline"><a href={emailLink}><Mail className="h-4 w-4 mr-1.5" />Enviar por email</a></Button>
            <Button asChild size="sm" variant="outline"><a href={fullUrl} target="_blank" rel="noopener noreferrer"><Link2 className="h-4 w-4 mr-1.5" />Previsualizar</a></Button>
            <Button onClick={generate} size="sm" variant="outline" disabled={loading}><RefreshCw className="h-4 w-4 mr-1.5" />Regenerar</Button>
            <Button onClick={revoke} size="sm" variant="ghost" className="text-destructive" disabled={loading}><Trash2 className="h-4 w-4 mr-1.5" />Revocar</Button>
          </div>
        </Card>
      )}
    </div>
  );
}
