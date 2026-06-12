import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sparkles, AlertTriangle, Info, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

const SEV = {
  warning: { icon: AlertTriangle, cls: "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400" },
  info: { icon: Info, cls: "border-primary/30 bg-primary/5 text-primary" },
  ok: { icon: CheckCircle2, cls: "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400" },
};

export default function Advisor() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [quarter, setQuarter] = useState(Math.floor(new Date().getMonth() / 3) + 1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setData(null);
    try { const { data } = await api.get(`/ai/advisor-review?year=${year}&quarter=${quarter}`); setData(data); }
    catch (e) { toast.error("Error generando análisis"); }
    finally { setLoading(false); }
  }, [year, quarter]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-6" data-testid="advisor-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-md bg-primary/10 text-primary flex items-center justify-center"><Sparkles className="h-5 w-5" /></div>
          <div>
            <h1 className="font-heading text-3xl font-bold">Modo Asesor</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Análisis pre-trimestre por IA con detección de errores</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>{[2024, 2025, 2026].map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={String(quarter)} onValueChange={(v) => setQuarter(Number(v))}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>{[1,2,3,4].map(q => <SelectItem key={q} value={String(q)}>T{q}</SelectItem>)}</SelectContent>
          </Select>
          <Button onClick={load} disabled={loading} data-testid="run-advisor">{loading ? "Analizando..." : "Analizar"}</Button>
        </div>
      </div>

      {!data ? <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-20" />)}</div> : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card className="p-4"><div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Facturas T{quarter}</div><div className="num text-2xl font-bold mt-1">{data.stats.invoices}</div></Card>
            <Card className="p-4"><div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Gastos T{quarter}</div><div className="num text-2xl font-bold mt-1">{data.stats.expenses}</div></Card>
            <Card className="p-4"><div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Pendientes</div><div className="num text-2xl font-bold mt-1 text-amber-600">{data.stats.pending}</div></Card>
            <Card className="p-4"><div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Vencidas</div><div className="num text-2xl font-bold mt-1 text-red-600">{data.stats.overdue}</div></Card>
          </div>

          <Card className="p-6 bg-primary/5 border-primary/20">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="h-4 w-4 text-primary" />
              <h3 className="font-heading font-semibold text-lg">Análisis IA</h3>
            </div>
            <div className="prose prose-sm dark:prose-invert max-w-none text-sm whitespace-pre-wrap text-muted-foreground">{data.ai_analysis}</div>
          </Card>

          <div className="space-y-3">
            <h3 className="font-heading font-semibold text-lg">Revisión automática</h3>
            {data.checks.length === 0 ? (
              <Card className="p-6 text-center bg-emerald-500/5 border-emerald-500/20">
                <CheckCircle2 className="h-8 w-8 text-emerald-600 mx-auto mb-2" />
                <p className="font-semibold text-emerald-700 dark:text-emerald-400">Todo en orden para este trimestre.</p>
              </Card>
            ) : (
              data.checks.map((c, i) => {
                const S = SEV[c.severity] || SEV.info;
                return (
                  <Card key={i} className={`p-4 border ${S.cls}`}>
                    <div className="flex items-start gap-3">
                      <S.icon className="h-4 w-4 mt-0.5 shrink-0" />
                      <div>
                        <div className="font-semibold text-sm">{c.title}</div>
                        <div className="text-xs opacity-80 mt-0.5">{c.detail}</div>
                      </div>
                    </div>
                  </Card>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
}
