import { useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Building2, Plus, Star, Trash2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { useProfile } from "@/contexts/ProfileContext";

const emptyProfile = {
  name: "", type: "autonomo", fiscal_name: "", nif: "", address: "", phone: "", email: "",
  logo_url: "", signature: "", default_iva: 21, default_irpf: 0,
  invoice_series: ["A"], primary_color: "#2563EB",
  bank_iban: "", bank_name: "", bank_swift: "",
};

export default function SettingsPage() {
  const { profiles, active, setActive, refresh } = useProfile() || {};
  const [seriesText, setSeriesText] = useState("");
  const [form, setForm] = useState(active || emptyProfile);
  const [open, setOpen] = useState(false);
  const [newP, setNewP] = useState(emptyProfile);

  useEffect(() => {
    if (active) {
      setForm(active);
      setSeriesText((active.invoice_series || ["A"]).join(", "));
    }
  }, [active]);

  const upd = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const save = async () => {
    try {
      const payload = {
        ...form,
        invoice_series: seriesText.split(",").map((s) => s.trim()).filter(Boolean),
        default_iva: Number(form.default_iva), default_irpf: Number(form.default_irpf),
      };
      await api.put(`/profiles/${active.id}`, payload);
      toast.success("Perfil guardado");
      refresh?.();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const createProfile = async () => {
    if (!newP.name) return toast.error("Nombre obligatorio");
    try {
      const { data } = await api.post("/profiles", newP);
      toast.success(`Perfil "${data.name}" creado`);
      setOpen(false); setNewP(emptyProfile); refresh?.();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const setDefault = async (pid) => {
    try { await api.post(`/profiles/${pid}/set-default`); toast.success("Por defecto"); refresh?.(); }
    catch (e) { toast.error(formatApiError(e)); }
  };

  const deleteProfile = async (pid) => {
    if (!window.confirm("¿Eliminar perfil? Los datos asociados no se borrarán pero quedarán huérfanos.")) return;
    try { await api.delete(`/profiles/${pid}`); toast.success("Perfil eliminado"); refresh?.(); }
    catch (e) { toast.error(formatApiError(e)); }
  };

  return (
    <div className="space-y-6" data-testid="settings-page">
      <div>
        <h1 className="font-heading text-3xl font-bold">Configuración</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Gestiona tus perfiles y datos fiscales</p>
      </div>

      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">Perfil activo</TabsTrigger>
          <TabsTrigger value="profiles">Mis perfiles</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="mt-4 space-y-6">
          {!active ? <Card className="p-8 text-center text-muted-foreground">Sin perfil activo</Card> : (
            <>
              <Card className="p-6 space-y-4">
                <h3 className="font-heading font-semibold text-lg">{active.name}</h3>
                <div className="grid md:grid-cols-2 gap-3">
                  <div><Label>Nombre del perfil</Label><Input value={form.name} onChange={upd("name")} className="mt-1.5" data-testid="profile-name" /></div>
                  <div>
                    <Label>Tipo</Label>
                    <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                      <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="autonomo">Autónomo</SelectItem>
                        <SelectItem value="sl">Empresa SL</SelectItem>
                        <SelectItem value="freelance">Freelance</SelectItem>
                        <SelectItem value="otros">Otros</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>Nombre/Razón social</Label><Input value={form.fiscal_name} onChange={upd("fiscal_name")} className="mt-1.5" data-testid="fiscal-name" /></div>
                  <div><Label>NIF/CIF</Label><Input value={form.nif} onChange={upd("nif")} className="mt-1.5" /></div>
                  <div className="md:col-span-2"><Label>Dirección fiscal</Label><Input value={form.address} onChange={upd("address")} className="mt-1.5" /></div>
                  <div><Label>Teléfono</Label><Input value={form.phone} onChange={upd("phone")} className="mt-1.5" /></div>
                  <div><Label>Email</Label><Input type="email" value={form.email} onChange={upd("email")} className="mt-1.5" /></div>
                  <div className="md:col-span-2">
                    <Label>Logo de la empresa</Label>
                    <div className="mt-1.5 flex items-start gap-3">
                      <div className="h-20 w-20 rounded-md border border-dashed border-border bg-muted/40 flex items-center justify-center overflow-hidden shrink-0">
                        {form.logo_url ? (
                          <img src={form.logo_url} alt="Logo" className="max-h-full max-w-full object-contain" />
                        ) : (
                          <span className="text-[10px] text-muted-foreground text-center px-1">Sin logo</span>
                        )}
                      </div>
                      <div className="flex-1 space-y-2">
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/svg+xml,image/webp"
                          data-testid="logo-upload"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            if (file.size > 2 * 1024 * 1024) { toast.error("Imagen muy grande (máx 2MB)"); return; }
                            const reader = new FileReader();
                            reader.onload = () => upd("logo_url")({ target: { value: reader.result } });
                            reader.readAsDataURL(file);
                          }}
                          className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary/10 file:text-primary file:px-3 file:py-1.5 file:text-xs file:font-semibold hover:file:bg-primary/20 file:cursor-pointer"
                        />
                        <div className="flex gap-2 items-center">
                          <Input value={form.logo_url || ""} onChange={upd("logo_url")} className="text-xs" placeholder="O pega una URL https://..." />
                          {form.logo_url && (
                            <Button type="button" variant="ghost" size="sm" onClick={() => upd("logo_url")({ target: { value: "" } })} data-testid="logo-clear">Quitar</Button>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground">PNG/JPG/SVG · máx 2 MB · aparecerá en facturas y presupuestos PDF.</p>
                      </div>
                    </div>
                  </div>
                </div>
              </Card>

              <Card className="p-6 space-y-4">
                <h3 className="font-heading font-semibold text-lg">Preferencias de facturación</h3>
                <div className="grid md:grid-cols-3 gap-3">
                  <div><Label>IVA por defecto %</Label><Input type="number" value={form.default_iva} onChange={upd("default_iva")} className="mt-1.5 num" /></div>
                  <div><Label>IRPF por defecto %</Label><Input type="number" value={form.default_irpf} onChange={upd("default_irpf")} className="mt-1.5 num" /></div>
                  <div><Label>Series</Label><Input value={seriesText} onChange={(e) => setSeriesText(e.target.value)} className="mt-1.5" placeholder="A, B, PRO" /></div>
                </div>
                <div><Label>Firma</Label><Textarea value={form.signature} onChange={upd("signature")} className="mt-1.5" /></div>
              </Card>

              <Card className="p-5">
                <h2 className="font-heading font-semibold mb-3">Datos bancarios</h2>
                <p className="text-xs text-muted-foreground mb-3">Aparecerán automáticamente en tus facturas para que el cliente sepa dónde pagarte.</p>
                <div className="grid md:grid-cols-2 gap-3">
                  <div className="md:col-span-2"><Label>IBAN</Label><Input value={form.bank_iban || ""} onChange={upd("bank_iban")} className="mt-1.5 font-mono" placeholder="ES91 2100 0418 4502 0005 1332" data-testid="iban-input" /></div>
                  <div><Label>Banco</Label><Input value={form.bank_name || ""} onChange={upd("bank_name")} className="mt-1.5" placeholder="CaixaBank, BBVA..." data-testid="bank-input" /></div>
                  <div><Label>SWIFT/BIC <span className="text-xs text-muted-foreground">(opcional)</span></Label><Input value={form.bank_swift || ""} onChange={upd("bank_swift")} className="mt-1.5 font-mono" placeholder="CAIXESBBXXX" /></div>
                </div>
              </Card>

              <Button onClick={save} data-testid="save-settings">Guardar cambios</Button>
            </>
          )}
        </TabsContent>

        <TabsContent value="profiles" className="mt-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Gestiona varios perfiles (autónomo, SL, proyecto paralelo). Cada uno tiene sus propios datos fiscales y series.</p>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild><Button size="sm" data-testid="new-profile-btn"><Plus className="h-3.5 w-3.5 mr-1" />Nuevo perfil</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Nuevo perfil</DialogTitle></DialogHeader>
                <div className="grid md:grid-cols-2 gap-3">
                  <div className="md:col-span-2"><Label>Nombre del perfil *</Label><Input value={newP.name} onChange={(e) => setNewP({ ...newP, name: e.target.value })} placeholder="Mi empresa SL" /></div>
                  <div><Label>Razón social</Label><Input value={newP.fiscal_name} onChange={(e) => setNewP({ ...newP, fiscal_name: e.target.value })} /></div>
                  <div><Label>NIF/CIF</Label><Input value={newP.nif} onChange={(e) => setNewP({ ...newP, nif: e.target.value })} /></div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
                  <Button onClick={createProfile}>Crear</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          {profiles?.map((p) => (
            <Card key={p.id} className="p-4 flex items-center gap-4">
              <div className="h-10 w-10 rounded-md bg-primary/10 text-primary flex items-center justify-center"><Building2 className="h-5 w-5" /></div>
              <div className="flex-1">
                <div className="font-semibold flex items-center gap-2">
                  {p.name}
                  {p.is_default && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 uppercase">Por defecto</span>}
                  {p.id === active?.id && <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary uppercase">Activo</span>}
                </div>
                <div className="text-xs text-muted-foreground">{p.type} · NIF {p.nif || "—"}</div>
              </div>
              <div className="flex gap-1">
                {p.id !== active?.id && <Button size="sm" variant="outline" onClick={() => { setActive(p.id); window.location.reload(); }}>Activar</Button>}
                {!p.is_default && <Button size="icon" variant="ghost" onClick={() => setDefault(p.id)} title="Establecer por defecto"><Star className="h-4 w-4" /></Button>}
                <Button size="icon" variant="ghost" className="text-destructive" onClick={() => deleteProfile(p.id)} disabled={profiles.length <= 1}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}
