import { useCallback, useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Pencil, Trash2, Search, Users } from "lucide-react";
import { toast } from "sonner";

const empty = { name: "", company: "", nif: "", address: "", email: "", phone: "", notes: "" };

export default function Clients() {
  const [items, setItems] = useState(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    try { const { data } = await api.get(`/clients${q ? `?q=${encodeURIComponent(q)}` : ""}`); setItems(data); }
    catch (e) { toast.error(formatApiError(e)); }
  }, [q]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!form.name) return toast.error("El nombre es obligatorio");
    try {
      if (editing) await api.put(`/clients/${editing}`, form);
      else await api.post("/clients", form);
      toast.success("Cliente guardado");
      setOpen(false); setForm(empty); setEditing(null); load();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const edit = (c) => { setForm(c); setEditing(c.id); setOpen(true); };
  const remove = async (id) => {
    if (!window.confirm("¿Eliminar cliente?")) return;
    try { await api.delete(`/clients/${id}`); toast.success("Cliente eliminado"); load(); }
    catch (e) { toast.error(formatApiError(e)); }
  };

  return (
    <div className="space-y-6" data-testid="clients-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-3xl font-bold">Clientes</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Tu cartera de clientes</p>
        </div>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setForm(empty); setEditing(null); } }}>
          <DialogTrigger asChild>
            <Button data-testid="new-client-button"><Plus className="h-4 w-4 mr-1" />Nuevo cliente</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>{editing ? "Editar cliente" : "Nuevo cliente"}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="grid md:grid-cols-2 gap-3">
                <div><Label>Nombre *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="client-name" /></div>
                <div><Label>Empresa</Label><Input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} /></div>
                <div><Label>NIF/CIF</Label><Input value={form.nif} onChange={(e) => setForm({ ...form, nif: e.target.value })} /></div>
                <div><Label>Teléfono</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
                <div className="md:col-span-2"><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
                <div className="md:col-span-2"><Label>Dirección</Label><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
                <div className="md:col-span-2"><Label>Notas</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button onClick={save} data-testid="save-client">Guardar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="relative max-w-xs">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Buscar cliente..." value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
      </div>

      {!items ? (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">{[1,2,3].map(i => <Skeleton key={i} className="h-40" />)}</div>
      ) : items.length === 0 ? (
        <Card className="p-12 text-center">
          <Users className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground mb-4">Aún no tienes clientes.</p>
          <Button onClick={() => setOpen(true)} size="sm">Crear primer cliente</Button>
        </Card>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((c) => (
            <Card key={c.id} className="p-5 hover:-translate-y-0.5 hover:shadow-md transition-all">
              <div className="flex items-start justify-between mb-3">
                <div className="h-10 w-10 rounded-md bg-primary/10 text-primary flex items-center justify-center font-bold">
                  {c.name?.slice(0, 2).toUpperCase()}
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => edit(c)}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => remove(c.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
              <h3 className="font-semibold">{c.name}</h3>
              {c.company && <p className="text-sm text-muted-foreground">{c.company}</p>}
              <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                {c.nif && <div className="num">NIF: {c.nif}</div>}
                {c.email && <div>{c.email}</div>}
                {c.phone && <div className="num">{c.phone}</div>}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
