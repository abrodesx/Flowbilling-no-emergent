import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, fmtEUR, fmtDate } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid, BarChart, Bar, Legend } from "recharts";
import { TrendingUp, TrendingDown, Wallet, FileWarning, Sparkles, Plus } from "lucide-react";
import { toast } from "sonner";

const STATUS_STYLES = {
  pagada: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  pendiente: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  vencida: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
};

function Kpi({ label, value, sub, icon: Icon, accent }) {
  return (
    <Card className="p-5 border-border bg-card">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
          <div className="num text-2xl font-bold mt-2">{value}</div>
          {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
        </div>
        <div className={`h-9 w-9 rounded-md flex items-center justify-center ${accent}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </Card>
  );
}

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [aiSummary, setAiSummary] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    api.get("/dashboard").then((r) => setData(r.data)).catch(() => toast.error("Error cargando dashboard"));
  }, []);

  const askAI = async () => {
    setAiLoading(true);
    try {
      const { data } = await api.post("/ai/financial-summary");
      setAiSummary(data.summary);
    } catch (e) {
      toast.error("No se pudo generar el resumen IA");
    } finally { setAiLoading(false); }
  };

  if (!data)
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <div className="grid md:grid-cols-4 gap-4">{[1,2,3,4].map(i => <Skeleton key={i} className="h-28" />)}</div>
        <Skeleton className="h-72" />
      </div>
    );

  return (
    <div className="space-y-6" data-testid="dashboard">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-3xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Resumen de tu actividad fiscal</p>
        </div>
        <Link to="/app/facturas/nueva"><Button data-testid="new-invoice-cta"><Plus className="h-4 w-4 mr-1" />Nueva factura</Button></Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Kpi label="Ingresos cobrados" value={fmtEUR(data.income_paid)} sub={`${data.paid_count} facturas pagadas`} icon={TrendingUp} accent="bg-emerald-500/10 text-emerald-600" />
        <Kpi label="Gastos" value={fmtEUR(data.expenses)} sub="acumulado" icon={TrendingDown} accent="bg-red-500/10 text-red-600" />
        <Kpi label="Beneficio neto" value={fmtEUR(data.benefit)} sub="ingresos - gastos" icon={Wallet} accent="bg-primary/10 text-primary" />
        <Kpi label="IVA a liquidar" value={fmtEUR(data.iva_balance)} sub={`Rep. ${fmtEUR(data.iva_rep)}`} icon={FileWarning} accent="bg-amber-500/10 text-amber-600" />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-heading font-semibold text-lg">Ingresos vs Gastos · 6 meses</h3>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.monthly}>
                <defs>
                  <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--chart-1))" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="hsl(var(--chart-1))" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="g2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--chart-5))" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="hsl(var(--chart-5))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                <Legend />
                <Area type="monotone" dataKey="ingresos" stroke="hsl(var(--chart-1))" fillOpacity={1} fill="url(#g1)" strokeWidth={2} />
                <Area type="monotone" dataKey="gastos" stroke="hsl(var(--chart-5))" fillOpacity={1} fill="url(#g2)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-heading font-semibold text-lg">Asistente IA</h3>
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
          {aiSummary ? (
            <p className="text-sm text-muted-foreground leading-relaxed">{aiSummary}</p>
          ) : (
            <p className="text-sm text-muted-foreground">Genera un análisis de tu situación financiera actual con IA.</p>
          )}
          <Button onClick={askAI} disabled={aiLoading} variant="outline" size="sm" className="mt-4 w-full" data-testid="ai-summary-btn">
            {aiLoading ? "Analizando..." : "Generar resumen IA"}
          </Button>

          <div className="grid grid-cols-3 gap-2 mt-6">
            <div className="text-center p-2 rounded bg-emerald-500/10"><div className="num text-lg font-bold text-emerald-600">{data.paid_count}</div><div className="text-[10px] uppercase text-muted-foreground">Pagadas</div></div>
            <div className="text-center p-2 rounded bg-amber-500/10"><div className="num text-lg font-bold text-amber-600">{data.pending_count}</div><div className="text-[10px] uppercase text-muted-foreground">Pendientes</div></div>
            <div className="text-center p-2 rounded bg-red-500/10"><div className="num text-lg font-bold text-red-600">{data.overdue_count}</div><div className="text-[10px] uppercase text-muted-foreground">Vencidas</div></div>
          </div>
        </Card>
      </div>

      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-heading font-semibold text-lg">Actividad reciente</h3>
          <Link to="/app/facturas" className="text-sm text-primary hover:underline">Ver todas</Link>
        </div>
        {data.recent.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <p className="mb-3">Aún no tienes facturas.</p>
            <Link to="/app/facturas/nueva"><Button size="sm">Crear la primera</Button></Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-border text-muted-foreground">
                  <th className="pb-2 font-medium">Número</th>
                  <th className="pb-2 font-medium">Cliente</th>
                  <th className="pb-2 font-medium">Fecha</th>
                  <th className="pb-2 font-medium text-right">Total</th>
                  <th className="pb-2 font-medium">Estado</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((i) => (
                  <tr key={i.id} className="border-b border-border last:border-0 hover:bg-muted/50">
                    <td className="py-3 num font-medium">{i.number}</td>
                    <td className="py-3">{i.client_name}</td>
                    <td className="py-3 text-muted-foreground">{fmtDate(i.issue_date)}</td>
                    <td className="py-3 num text-right font-semibold">{fmtEUR(i.total)}</td>
                    <td className="py-3"><Badge variant="outline" className={STATUS_STYLES[i.status]}>{i.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
