import { useEffect, useRef, useState } from "react";
import { api, fmtEUR, fmtDate, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Play, Pause, Plus, Trash2, Clock, FileText } from "lucide-react";
import { toast } from "sonner";

const empty = { project_id: "", description: "", duration_minutes: 0, date: new Date().toISOString().slice(0, 10), hourly_rate: "" };

function fmtDuration(mins) {
  const h = Math.floor(mins / 60);
  const m = Math.floor(mins % 60);
  const s = Math.floor((mins * 60) % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function TimeTracking() {
  const [items, setItems] = useState(null);
  const [projects, setProjects] = useState([]);
  const [clients, setClients] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [selected, setSelected] = useState({});

  // Cronómetro
  const [running, setRunning] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [stopwatchProject, setStopwatchProject] = useState("");
  const [stopwatchDesc, setStopwatchDesc] = useState("");
  const intervalRef = useRef(null);

  // Convert dialog
  const [convertOpen, setConvertOpen] = useState(false);
  const [convertClient, setConvertClient] = useState("");

  const load = async () => {
    try {
      const [{ data: ts }, { data: ps }, { data: cs }] = await Promise.all([
        api.get("/time-entries?billed=false"),
        api.get("/projects"),
        api.get("/clients"),
      ]);
      setItems(ts); setProjects(ps); setClients(cs);
    } catch (e) { toast.error(formatApiError(e)); }
  };
  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (running) intervalRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    else clearInterval(intervalRef.current);
    return () => clearInterval(intervalRef.current);
  }, [running]);

  const startStop = () => {
    if (!stopwatchProject) return toast.error("Selecciona un proyecto");
    setRunning((r) => !r);
  };

  const stopAndSave = async () => {
    if (!seconds) return toast.error("No hay tiempo registrado");
    const minutes = Math.max(1, Math.round(seconds / 60));
    try {
      await api.post("/time-entries", {
        project_id: stopwatchProject, description: stopwatchDesc || "Sesión sin descripción",
        duration_minutes: minutes, date: new Date().toISOString().slice(0, 10),
      });
      toast.success("Tiempo guardado");
      setSeconds(0); setRunning(false); setStopwatchDesc(""); load();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const save = async () => {
    if (!form.project_id) return toast.error("Selecciona un proyecto");
    const minutes = Number(form.duration_minutes);
    if (!minutes) return toast.error("Duración inválida");
    try {
      const payload = {
        ...form, duration_minutes: minutes,
        hourly_rate: form.hourly_rate ? Number(form.hourly_rate) : null,
      };
      await api.post("/time-entries", payload);
      toast.success("Entrada guardada");
      setOpen(false); setForm(empty); load();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const remove = async (id) => {
    if (!window.confirm("¿Eliminar entrada?")) return;
    try { await api.delete(`/time-entries/${id}`); toast.success("Eliminada"); load(); }
    catch (e) { toast.error(formatApiError(e)); }
  };

  const selectedIds = Object.keys(selected).filter((k) => selected[k]);
  const selectedItems = items?.filter((t) => selectedIds.includes(t.id)) || [];
  const selectedTotal = selectedItems.reduce((s, t) => s + (t.amount || 0), 0);

  const convert = async () => {
    if (!convertClient) return toast.error("Selecciona un cliente");
    try {
      const { data } = await api.post("/time-entries/convert-to-invoice", {
        time_entry_ids: selectedIds, client_id: convertClient,
      });
      toast.success(`Factura ${data.number} creada`);
      setSelected({}); setConvertOpen(false); load();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  return (
    <div className="space-y-6" data-testid="time-tracking">
      <div>
        <h1 className="font-heading text-3xl font-bold">Control horario</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Registra horas y conviértelas en facturas</p>
      </div>

      {/* Cronómetro */}
      <Card className="p-6">
        <div className="flex flex-wrap items-center gap-4">
          <div className="num text-4xl font-bold tracking-wider tabular-nums" data-testid="stopwatch-display">{fmtDuration(seconds)}</div>
          <div className="flex-1 min-w-[200px]">
            <Select value={stopwatchProject} onValueChange={setStopwatchProject}>
              <SelectTrigger><SelectValue placeholder="Proyecto" /></SelectTrigger>
              <SelectContent>{projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <Input className="flex-1 min-w-[200px]" placeholder="¿En qué trabajas?" value={stopwatchDesc} onChange={(e) => setStopwatchDesc(e.target.value)} />
          <Button onClick={startStop} variant={running ? "destructive" : "default"} data-testid="stopwatch-toggle">
            {running ? <><Pause className="h-4 w-4 mr-1" />Pausar</> : <><Play className="h-4 w-4 mr-1" />Iniciar</>}
          </Button>
          {seconds > 0 && !running && (
            <Button onClick={stopAndSave} variant="outline" data-testid="stopwatch-save">Guardar</Button>
          )}
        </div>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-heading font-semibold text-lg">Entradas pendientes de facturar</h2>
        <div className="flex gap-2">
          {selectedIds.length > 0 && (
            <Dialog open={convertOpen} onOpenChange={setConvertOpen}>
              <DialogTrigger asChild>
                <Button data-testid="convert-time-button"><FileText className="h-4 w-4 mr-1" />Facturar {selectedIds.length} entradas · {fmtEUR(selectedTotal)}</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Convertir a factura</DialogTitle></DialogHeader>
                <Label>Cliente</Label>
                <Select value={convertClient} onValueChange={setConvertClient}>
                  <SelectTrigger><SelectValue placeholder="Selecciona cliente" /></SelectTrigger>
                  <SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
                <p className="text-sm text-muted-foreground">{selectedIds.length} entradas · Total estimado {fmtEUR(selectedTotal)}</p>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setConvertOpen(false)}>Cancelar</Button>
                  <Button onClick={convert} data-testid="confirm-convert">Crear factura</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button variant="outline"><Plus className="h-4 w-4 mr-1" />Añadir manual</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Nueva entrada de tiempo</DialogTitle></DialogHeader>
              <div className="grid md:grid-cols-2 gap-3">
                <div className="md:col-span-2">
                  <Label>Proyecto</Label>
                  <Select value={form.project_id} onValueChange={(v) => setForm({ ...form, project_id: v })}>
                    <SelectTrigger><SelectValue placeholder="Selecciona" /></SelectTrigger>
                    <SelectContent>{projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="md:col-span-2"><Label>Descripción</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
                <div><Label>Minutos</Label><Input type="number" value={form.duration_minutes} onChange={(e) => setForm({ ...form, duration_minutes: e.target.value })} className="num" /></div>
                <div><Label>Fecha</Label><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
                <div className="md:col-span-2"><Label>€/hora (opcional, usa el del proyecto si vacío)</Label><Input type="number" step="0.01" value={form.hourly_rate} onChange={(e) => setForm({ ...form, hourly_rate: e.target.value })} className="num" /></div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
                <Button onClick={save}>Guardar</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        {!items ? <div className="p-6 space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-12" />)}</div> :
          items.length === 0 ? (
            <div className="p-12 text-center">
              <Clock className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">Sin entradas pendientes.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40"><tr className="text-left text-muted-foreground">
                  <th className="px-4 py-3 w-10"></th>
                  <th className="px-4 py-3">Fecha</th>
                  <th className="px-4 py-3">Proyecto</th>
                  <th className="px-4 py-3">Descripción</th>
                  <th className="px-4 py-3 text-right">Horas</th>
                  <th className="px-4 py-3 text-right">€/h</th>
                  <th className="px-4 py-3 text-right">Importe</th>
                  <th className="px-4 py-3"></th>
                </tr></thead>
                <tbody>
                  {items.map(t => (
                    <tr key={t.id} className="border-t border-border hover:bg-muted/30">
                      <td className="px-4 py-2"><Checkbox checked={!!selected[t.id]} onCheckedChange={(c) => setSelected({ ...selected, [t.id]: !!c })} /></td>
                      <td className="px-4 py-2 text-muted-foreground">{fmtDate(t.date)}</td>
                      <td className="px-4 py-2">{t.project_name}</td>
                      <td className="px-4 py-2">{t.description}</td>
                      <td className="px-4 py-2 text-right num">{(t.duration_minutes / 60).toFixed(2)}h</td>
                      <td className="px-4 py-2 text-right num">{fmtEUR(t.hourly_rate)}</td>
                      <td className="px-4 py-2 text-right num font-semibold">{fmtEUR(t.amount)}</td>
                      <td className="px-4 py-2 text-right"><Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => remove(t.id)}><Trash2 className="h-3 w-3" /></Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Card>
    </div>
  );
}
