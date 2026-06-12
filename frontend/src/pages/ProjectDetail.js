import { useEffect, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { api, fmtEUR, fmtDate, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Briefcase, FileText, Receipt, Clock, Plus } from "lucide-react";
import { toast } from "sonner";

export default function ProjectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [p, setP] = useState(null);

  useEffect(() => {
    api.get(`/projects/${id}`).then((r) => setP(r.data)).catch((e) => toast.error(formatApiError(e)));
  }, [id]);

  if (!p) return <Skeleton className="h-96" />;

  const totalHours = p.time_entries?.reduce((s, t) => s + t.duration_minutes, 0) / 60 || 0;
  const totalAmount = p.time_entries?.reduce((s, t) => s + (t.amount || 0), 0) || 0;
  const invoiced = p.invoices?.reduce((s, i) => s + (i.subtotal || 0), 0) || 0;
  const expenses = p.expenses?.reduce((s, e) => s + (e.amount || 0), 0) || 0;

  return (
    <div className="space-y-6" data-testid="project-detail">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/app/proyectos")}><ArrowLeft className="h-4 w-4" /></Button>
        <div className="h-12 w-12 rounded-md flex items-center justify-center" style={{ background: `${p.color}22`, color: p.color }}>
          <Briefcase className="h-6 w-6" />
        </div>
        <div>
          <h1 className="font-heading text-3xl font-bold">{p.name}</h1>
          <p className="text-sm text-muted-foreground">{p.description || "—"}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4"><div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Horas registradas</div><div className="num text-xl font-bold mt-1">{totalHours.toFixed(1)}h</div></Card>
        <Card className="p-4"><div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Importe horas</div><div className="num text-xl font-bold mt-1">{fmtEUR(totalAmount)}</div></Card>
        <Card className="p-4"><div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Facturado</div><div className="num text-xl font-bold mt-1 text-emerald-600">{fmtEUR(invoiced)}</div></Card>
        <Card className="p-4"><div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Gastos</div><div className="num text-xl font-bold mt-1 text-red-600">{fmtEUR(expenses)}</div></Card>
      </div>

      <Tabs defaultValue="time">
        <TabsList>
          <TabsTrigger value="time"><Clock className="h-3.5 w-3.5 mr-1" />Horas ({p.time_entries?.length || 0})</TabsTrigger>
          <TabsTrigger value="invoices"><FileText className="h-3.5 w-3.5 mr-1" />Facturas ({p.invoices?.length || 0})</TabsTrigger>
          <TabsTrigger value="expenses"><Receipt className="h-3.5 w-3.5 mr-1" />Gastos ({p.expenses?.length || 0})</TabsTrigger>
        </TabsList>

        <TabsContent value="time" className="mt-4">
          <Card>
            <div className="px-4 py-3 flex items-center justify-between border-b border-border">
              <h3 className="font-semibold">Entradas de tiempo</h3>
              <Link to="/app/horas"><Button size="sm" variant="outline"><Plus className="h-3.5 w-3.5 mr-1" />Añadir</Button></Link>
            </div>
            {!p.time_entries?.length ? <div className="p-8 text-center text-muted-foreground text-sm">Sin horas registradas.</div> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40"><tr className="text-left text-muted-foreground">
                    <th className="px-4 py-2">Fecha</th><th className="px-4 py-2">Descripción</th>
                    <th className="px-4 py-2 text-right">Horas</th><th className="px-4 py-2 text-right">€/h</th>
                    <th className="px-4 py-2 text-right">Importe</th><th className="px-4 py-2">Estado</th>
                  </tr></thead>
                  <tbody>
                    {p.time_entries.map(t => (
                      <tr key={t.id} className="border-t border-border">
                        <td className="px-4 py-2 text-muted-foreground">{fmtDate(t.date)}</td>
                        <td className="px-4 py-2">{t.description}</td>
                        <td className="px-4 py-2 text-right num">{(t.duration_minutes / 60).toFixed(2)}h</td>
                        <td className="px-4 py-2 text-right num">{fmtEUR(t.hourly_rate)}</td>
                        <td className="px-4 py-2 text-right num font-semibold">{fmtEUR(t.amount)}</td>
                        <td className="px-4 py-2"><span className={`text-[10px] px-2 py-0.5 rounded ${t.billed ? "bg-emerald-500/10 text-emerald-600" : "bg-amber-500/10 text-amber-600"}`}>{t.billed ? "facturado" : "pendiente"}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="invoices" className="mt-4">
          <Card>
            {!p.invoices?.length ? <div className="p-8 text-center text-muted-foreground text-sm">Sin facturas.</div> : (
              <table className="w-full text-sm">
                <thead className="bg-muted/40"><tr className="text-left text-muted-foreground">
                  <th className="px-4 py-2">Número</th><th className="px-4 py-2">Cliente</th>
                  <th className="px-4 py-2">Fecha</th><th className="px-4 py-2 text-right">Total</th>
                </tr></thead>
                <tbody>
                  {p.invoices.map(i => (
                    <tr key={i.id} className="border-t border-border">
                      <td className="px-4 py-2 num font-medium"><Link to={`/app/facturas/${i.id}`} className="hover:text-primary">{i.number}</Link></td>
                      <td className="px-4 py-2">{i.client_name}</td>
                      <td className="px-4 py-2 text-muted-foreground">{fmtDate(i.issue_date)}</td>
                      <td className="px-4 py-2 text-right num font-semibold">{fmtEUR(i.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="expenses" className="mt-4">
          <Card>
            {!p.expenses?.length ? <div className="p-8 text-center text-muted-foreground text-sm">Sin gastos.</div> : (
              <table className="w-full text-sm">
                <thead className="bg-muted/40"><tr className="text-left text-muted-foreground">
                  <th className="px-4 py-2">Fecha</th><th className="px-4 py-2">Descripción</th>
                  <th className="px-4 py-2">Categoría</th><th className="px-4 py-2 text-right">Importe</th>
                </tr></thead>
                <tbody>
                  {p.expenses.map(e => (
                    <tr key={e.id} className="border-t border-border">
                      <td className="px-4 py-2 text-muted-foreground">{fmtDate(e.date)}</td>
                      <td className="px-4 py-2">{e.description}</td>
                      <td className="px-4 py-2 text-xs">{e.category}</td>
                      <td className="px-4 py-2 text-right num font-semibold">{fmtEUR(e.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
