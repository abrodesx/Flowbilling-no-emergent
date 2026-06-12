import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { History, Plus, Pencil, Trash2, Upload, Sparkles } from "lucide-react";

const ICONS = { create: Plus, update: Pencil, delete: Trash2, import: Upload };
const ACTION_LABEL = { create: "Creado", update: "Modificado", delete: "Eliminado", import: "Importado" };
const ACTION_COLOR = {
  create: "text-emerald-600 bg-emerald-500/10",
  update: "text-blue-600 bg-blue-500/10",
  delete: "text-red-600 bg-red-500/10",
  import: "text-purple-600 bg-purple-500/10",
};
const ENTITY_LABEL = { invoice: "Factura", client: "Cliente", expense: "Gasto", quote: "Presupuesto", import: "Importación" };

export default function Audit() {
  const [items, setItems] = useState(null);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    (async () => {
      const { data } = await api.get("/audit?limit=500");
      setItems(data);
    })();
  }, []);

  const filtered = items?.filter(it => filter === "all" || it.entity_type === filter);

  return (
    <div className="space-y-6" data-testid="audit-page">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-md bg-primary/10 text-primary flex items-center justify-center"><History className="h-5 w-5" /></div>
          <div>
            <h1 className="font-heading text-3xl font-bold">Auditoría</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Histórico de todos los cambios en este perfil.</p>
          </div>
        </div>
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="invoice">Facturas</SelectItem>
            <SelectItem value="client">Clientes</SelectItem>
            <SelectItem value="expense">Gastos</SelectItem>
            <SelectItem value="quote">Presupuestos</SelectItem>
            <SelectItem value="import">Importaciones</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {!items ? (
        <div className="space-y-2">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-14" />)}</div>
      ) : !filtered?.length ? (
        <Card className="p-12 text-center">
          <Sparkles className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Aún no hay eventos registrados.</p>
        </Card>
      ) : (
        <Card className="p-0 overflow-hidden">
          <div className="divide-y divide-border">
            {filtered.map((ev) => {
              const Icon = ICONS[ev.action] || Pencil;
              const cls = ACTION_COLOR[ev.action] || "text-muted-foreground bg-muted";
              return (
                <div key={ev.id} className="px-4 py-3 grid grid-cols-12 gap-3 items-center hover:bg-muted/40">
                  <div className={`col-span-1 h-8 w-8 rounded-full flex items-center justify-center ${cls}`}><Icon className="h-4 w-4" /></div>
                  <div className="col-span-7">
                    <div className="text-sm">
                      <span className="font-medium">{ev.actor_name || "Sistema"}</span>{" "}
                      <span className="text-muted-foreground">{ACTION_LABEL[ev.action]?.toLowerCase() || ev.action}</span>{" "}
                      <span className="font-medium">{ENTITY_LABEL[ev.entity_type] || ev.entity_type}</span>{" "}
                      {ev.entity_label && <span className="text-primary">{ev.entity_label}</span>}
                    </div>
                    {ev.changes && Object.keys(ev.changes).length > 0 && (
                      <div className="text-[11px] text-muted-foreground mt-0.5 font-mono">
                        {Object.entries(ev.changes).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(" · ")}
                      </div>
                    )}
                  </div>
                  <div className="col-span-4 text-xs text-muted-foreground text-right">
                    {new Date(ev.created_at).toLocaleString("es-ES")}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}
