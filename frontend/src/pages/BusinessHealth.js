import { useEffect, useState } from "react";
import { api, fmtEUR } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, Activity, Users, BarChart3 } from "lucide-react";
import { toast } from "sonner";

function ScoreBar({ label, score, icon: Icon, hint }) {
  const color = score >= 70 ? "bg-emerald-500" : score >= 40 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium"><Icon className="h-4 w-4 text-muted-foreground" />{label}</div>
        <span className="num font-semibold">{score}<span className="text-xs text-muted-foreground">/100</span></span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div className={`h-full ${color} transition-all`} style={{ width: `${Math.max(0, Math.min(100, score))}%` }} />
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export default function BusinessHealth() {
  const [data, setData] = useState(null);
  useEffect(() => { api.get("/analytics/health").then((r) => setData(r.data)).catch(() => toast.error("Error")); }, []);

  if (!data) return <div className="space-y-4"><Skeleton className="h-32" /><Skeleton className="h-64" /></div>;

  const overall = data.overall_score;
  const overallColor = overall >= 70 ? "text-emerald-600" : overall >= 40 ? "text-amber-600" : "text-red-600";

  return (
    <div className="space-y-6" data-testid="health-page">
      <div>
        <h1 className="font-heading text-3xl font-bold">Salud del negocio</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Diagnóstico holístico de tu actividad</p>
      </div>

      <Card className="p-8 text-center">
        <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Score general</div>
        <div className={`num text-6xl font-bold mt-2 ${overallColor}`}>{overall}</div>
        <div className="text-sm text-muted-foreground">{overall >= 70 ? "Excelente · Negocio saludable" : overall >= 40 ? "Razonable · Hay margen de mejora" : "Atención · Revisa áreas críticas"}</div>
      </Card>

      <div className="grid md:grid-cols-2 gap-6">
        <Card className="p-6 space-y-5">
          <h3 className="font-heading font-semibold text-lg">Indicadores</h3>
          <ScoreBar label="Liquidez" score={data.scores.liquidity} icon={Activity} hint={`Pendiente de cobro: ${fmtEUR(data.metrics.pending_amount)}`} />
          <ScoreBar label="Crecimiento (interanual)" score={Math.max(0, Math.min(100, 50 + data.scores.growth / 4))} icon={TrendingUp} hint={`${data.metrics.growth_yoy_pct >= 0 ? "+" : ""}${data.metrics.growth_yoy_pct}% vs año anterior`} />
          <ScoreBar label="Diversificación clientes" score={data.scores.client_diversification} icon={Users} hint={`Cliente top: ${data.metrics.top_client_share_pct}% de tus ingresos`} />
          <ScoreBar label="Estabilidad mensual" score={data.scores.stability} icon={BarChart3} hint="Consistencia de ingresos a lo largo del año" />
        </Card>

        <Card className="p-6 space-y-4">
          <h3 className="font-heading font-semibold text-lg">Métricas clave</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded bg-muted/40"><div className="text-[10px] uppercase text-muted-foreground">Cobrado año</div><div className="num text-xl font-bold mt-1">{fmtEUR(data.metrics.cash_in_year)}</div></div>
            <div className="p-3 rounded bg-amber-500/10"><div className="text-[10px] uppercase text-muted-foreground">Pendiente</div><div className="num text-xl font-bold mt-1 text-amber-600">{fmtEUR(data.metrics.pending_amount)}</div></div>
            <div className="p-3 rounded bg-primary/10"><div className="text-[10px] uppercase text-muted-foreground">Clientes activos</div><div className="num text-xl font-bold mt-1 text-primary">{data.metrics.num_clients}</div></div>
            <div className={`p-3 rounded ${data.metrics.growth_yoy_pct >= 0 ? "bg-emerald-500/10" : "bg-red-500/10"}`}><div className="text-[10px] uppercase text-muted-foreground">Crecimiento</div><div className={`num text-xl font-bold mt-1 ${data.metrics.growth_yoy_pct >= 0 ? "text-emerald-600" : "text-red-600"}`}>{data.metrics.growth_yoy_pct >= 0 ? "+" : ""}{data.metrics.growth_yoy_pct}%</div></div>
          </div>
        </Card>
      </div>
    </div>
  );
}
