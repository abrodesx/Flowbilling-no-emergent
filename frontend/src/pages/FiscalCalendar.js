import { useEffect, useState } from "react";
import { api, fmtDate } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar, AlertCircle } from "lucide-react";

const TYPE_COLOR = {
  iva: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  irpf: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  renta: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
};

export default function FiscalCalendar() {
  const [items, setItems] = useState(null);
  const year = new Date().getFullYear();

  useEffect(() => {
    api.get(`/fiscal-calendar/${year}`).then(r => setItems(r.data));
  }, [year]);

  const today = new Date();
  const upcoming = items?.filter(i => new Date(i.date) >= today) || [];
  const past = items?.filter(i => new Date(i.date) < today) || [];

  return (
    <div className="space-y-6" data-testid="calendar-page">
      <div>
        <h1 className="font-heading text-3xl font-bold">Calendario fiscal {year}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Modelos y vencimientos clave para autónomos en España</p>
      </div>

      {!items ? (
        <div className="space-y-3">{[1,2,3,4].map(i => <Skeleton key={i} className="h-16" />)}</div>
      ) : (
        <>
          <section>
            <h2 className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-3">Próximos vencimientos</h2>
            <div className="space-y-2">
              {upcoming.length === 0 ? <Card className="p-6 text-center text-muted-foreground">No hay vencimientos próximos este año.</Card> :
                upcoming.map((it, i) => {
                  const d = new Date(it.date);
                  const days = Math.ceil((d - today) / 86400000);
                  return (
                    <Card key={i} className="p-4 flex items-center gap-4 hover:shadow-md transition-shadow">
                      <div className="w-14 text-center bg-muted rounded-md p-2 shrink-0">
                        <div className="text-xs uppercase text-muted-foreground">{d.toLocaleDateString("es-ES", { month: "short" })}</div>
                        <div className="num text-xl font-bold">{d.getDate()}</div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold">{it.model}</div>
                        <div className="text-sm text-muted-foreground">{it.description}</div>
                      </div>
                      <div className="flex flex-col items-end gap-1.5 shrink-0">
                        <span className={`text-xs px-2 py-0.5 rounded border ${TYPE_COLOR[it.type]}`}>{it.type.toUpperCase()}</span>
                        <span className={`text-xs ${days <= 7 ? "text-destructive font-semibold" : "text-muted-foreground"}`}>
                          {days === 0 ? "Hoy" : days === 1 ? "Mañana" : `${days} días`}
                        </span>
                      </div>
                    </Card>
                  );
                })
              }
            </div>
          </section>
          {past.length > 0 && (
            <section>
              <h2 className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-3">Vencidos</h2>
              <div className="space-y-2 opacity-60">
                {past.map((it, i) => (
                  <Card key={i} className="p-4 flex items-center gap-4">
                    <div className="w-14 text-center bg-muted rounded-md p-2 shrink-0">
                      <div className="text-xs uppercase text-muted-foreground">{new Date(it.date).toLocaleDateString("es-ES", { month: "short" })}</div>
                      <div className="num text-xl font-bold">{new Date(it.date).getDate()}</div>
                    </div>
                    <div className="flex-1"><div className="font-semibold">{it.model}</div><div className="text-sm text-muted-foreground">{it.description}</div></div>
                  </Card>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
