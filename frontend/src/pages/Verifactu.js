import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ShieldCheck, Hash, QrCode, Link2 } from "lucide-react";
import { toast } from "sonner";

export default function Verifactu() {
  const [chain, setChain] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/verifactu/chain");
        setChain(data);
      } catch (e) {
        toast.error("Error cargando registro Verifactu");
      }
    })();
  }, []);

  return (
    <div className="space-y-6" data-testid="verifactu-page">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <div>
          <h1 className="font-heading text-3xl font-bold">Verifactu</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Registro inmutable de facturas con hash encadenado SHA-256 y QR oficial (RD 1007/2023).
          </p>
        </div>
      </div>

      <Card className="p-4 bg-primary/5 border-primary/20">
        <div className="grid sm:grid-cols-3 gap-4 text-sm">
          <div className="flex items-start gap-2">
            <Hash className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <div><b>Hash encadenado</b><div className="text-xs text-muted-foreground">Cada factura referencia el hash de la anterior. Si una factura se modifica o borra, toda la cadena queda invalidada.</div></div>
          </div>
          <div className="flex items-start gap-2">
            <QrCode className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <div><b>QR de verificación</b><div className="text-xs text-muted-foreground">Cada factura incluye un QR que permite verificar su autenticidad públicamente.</div></div>
          </div>
          <div className="flex items-start gap-2">
            <Link2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <div><b>Trazabilidad</b><div className="text-xs text-muted-foreground">Eventos de emisión/anulación se registran cronológicamente.</div></div>
          </div>
        </div>
      </Card>

      {!chain ? (
        <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : chain.count === 0 ? (
        <Card className="p-12 text-center">
          <ShieldCheck className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            Aún no hay facturas firmadas con Verifactu en este perfil.
            <br />Crea una factura para iniciar la cadena.
          </p>
        </Card>
      ) : (
        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <h3 className="font-heading font-semibold">Cadena de eventos</h3>
            <span className="text-xs text-muted-foreground"><span className="num font-semibold">{chain.count}</span> eventos</span>
          </div>
          <div className="divide-y divide-border">
            {chain.events.map((ev, i) => (
              <div key={ev.id} className="px-4 py-3 grid grid-cols-12 gap-3 items-center hover:bg-muted/40 transition-colors" data-testid={`vf-event-${i}`}>
                <div className="col-span-1 text-xs text-muted-foreground num">#{i + 1}</div>
                <div className="col-span-2">
                  <div className="text-sm font-semibold">{ev.invoice_number}</div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{ev.event}</div>
                </div>
                <div className="col-span-3 text-xs text-muted-foreground">{new Date(ev.created_at).toLocaleString("es-ES")}</div>
                <div className="col-span-6 font-mono text-[10px] break-all">
                  <div className="text-muted-foreground">prev: <span className="text-foreground/60">{ev.prev_hash?.slice(0, 24)}…</span></div>
                  <div className="text-emerald-600 dark:text-emerald-400">hash: {ev.hash?.slice(0, 24)}…</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
