import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, fmtEUR, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Briefcase, Trash2, Pencil, Clock, FileText, Receipt } from "lucide-react";
import { toast } from "sonner";

const empty = { name: "", client_id: "", description: "", status: "activo", hourly_rate: 0, budget: 0, color: "#2563EB" };

export default function Projects() {
  const [items, setItems] = useState(null);
  const [clients, setClients] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);

  const load = async () => {
    try {
      const [{ data: ps }, { data: cs }] = await Promise.all([api.get("/projects"), api.get("/clients")]);
      setItems(ps); setClients(cs);
    } catch (e) { toast.error(formatApiError(e)); }
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.name) return toast.error("El nombre es obligatorio");
    const payload = { ...form, hourly_rate: Number(form.hourly_rate) || 0, budget: Number(form.budget) || 0 };
    try {
      if (editing) await api.put(`/projects/${editing}`, payload);
      else await api.post("/projects", payload);
      toast.success("Proyecto guardado");
      setOpen(false); setForm(empty); setEditing(null); load();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const remove = async (id) => {
    if (!window.confirm("¿Eliminar proyecto? Las facturas y gastos asociados se desvincularán.")) return;
    try { await api.delete(`/projects/${id}`); toast.success("Eliminado"); load(); }
    catch (e) { toast.error(formatApiError(e)); }
  };

  return (
    <div className="space-y-6" data-testid="projects-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-3xl font-bold">Proyectos</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Agrupa horas, gastos y facturas por proyecto</p>
        </div>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setForm(empty); setEditing(null); } }}>
          <DialogTrigger asChild><Button data-testid="new-project-button"><Plus className="h-4 w-4 mr-1" />Nuevo proyecto</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{editing ? "Editar proyecto" : "Nuevo proyecto"}</DialogTitle></DialogHeader>
            <div className="grid md:grid-cols-2 gap-3">
              <div className="md:col-span-2"><Label>Nombre *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="project-name" /></div>
              <div className="md:col-span-2">
                <Label>Cliente</Label>
                <Select value={form.client_id || "none"} onValueChange={(v) => setForm({ ...form, client_id: v === "none" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder="Sin cliente" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sin cliente</SelectItem>
                    {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Estado</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="activo">Activo</SelectItem>
                    <SelectItem value="pausado">Pausado</SelectItem>
                    <SelectItem value="completado">Completado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Color</Label><Input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className="h-10" /></div>
              <div><Label>€/hora</Label><Input type="number" step="0.01" value={form.hourly_rate} onChange={(e) => setForm({ ...form, hourly_rate: e.target.value })} className="num" /></div>
              <div><Label>Presupuesto €</Label><Input type="number" step="0.01" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} className="num" /></div>
              <div className="md:col-span-2"><Label>Descripción</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button onClick={save} data-testid="save-project">Guardar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {!items ? <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">{[1,2,3].map(i => <Skeleton key={i} className="h-48" />)}</div> :
        items.length === 0 ? (
          <Card className="p-12 text-center">
            <Briefcase className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground mb-4">Aún no tienes proyectos.</p>
            <Button onClick={() => setOpen(true)} size="sm">Crear primer proyecto</Button>
          </Card>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {items.map((p) => (
              <Link key={p.id} to={`/app/proyectos/${p.id}`}>
                <Card className="p-5 hover:-translate-y-0.5 hover:shadow-md transition-all h-full cursor-pointer">
                  <div className="flex items-start justify-between mb-3">
                    <div className="h-10 w-10 rounded-md flex items-center justify-center" style={{ background: `${p.color}22`, color: p.color }}>
                      <Briefcase className="h-5 w-5" />
                    </div>
                    <span className={`text-[10px] uppercase px-2 py-0.5 rounded ${p.status === "activo" ? "bg-emerald-500/10 text-emerald-600" : p.status === "pausado" ? "bg-amber-500/10 text-amber-600" : "bg-muted"}`}>{p.status}</span>
                  </div>
                  <h3 className="font-semibold">{p.name}</h3>
                  {p.description && <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{p.description}</p>}
                  <div className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-border">
                    <div><div className="text-[10px] uppercase text-muted-foreground">Horas</div><div className="num font-semibold">{p.stats?.hours || 0}h</div></div>
                    <div><div className="text-[10px] uppercase text-muted-foreground">Facturado</div><div className="num font-semibold">{fmtEUR(p.stats?.invoiced)}</div></div>
                    <div><div className="text-[10px] uppercase text-muted-foreground">Gastos</div><div className="num font-semibold">{fmtEUR(p.stats?.expenses)}</div></div>
                  </div>
                  <div className="flex justify-end gap-1 mt-3">
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={(e) => { e.preventDefault(); setForm(p); setEditing(p.id); setOpen(true); }}><Pencil className="h-3 w-3" /></Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={(e) => { e.preventDefault(); remove(p.id); }}><Trash2 className="h-3 w-3" /></Button>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
    </div>
  );
}
