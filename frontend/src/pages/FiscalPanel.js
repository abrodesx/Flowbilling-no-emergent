import { useEffect, useState } from "react";
import { api, fmtEUR } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Landmark, TrendingUp, AlertCircle, Calculator } from "lucide-react";
import { toast } from "sonner";

function Stat({ label, value, sub, accent = "" }) {
  return (
    <div className="p-4 rounded-md bg-muted/40 border border-border">
      <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
      <div className={`num text-xl font-bold mt-1 ${accent}`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

export default function FiscalPanel() {
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get("/fiscal/projection").then((r) => setData(r.data)).catch(() => toast.error("Error cargando panel fiscal"));
  }, []);

  if (!data) return <div className="space-y-4"><Skeleton className="h-12 w-72" /><div className="grid md:grid-cols-3 gap-4">{[1,2,3].map(i => <Skeleton key={i} className="h-32" />)}</div></div>;

  const c = data.current;
  const tax = data.current_quarter_taxes;
  const proj = data.yearly_projection;

  return (
    <div className="space-y-6" data-testid="fiscal-panel">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-md bg-primary/10 text-primary flex items-center justify-center"><Landmark className="h-5 w-5" /></div>
        <div>
          <h1 className="font-heading text-3xl font-bold">Panel fiscal inteligente</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Año {data.year} · Trimestre actual T{data.quarter}</p>
        </div>
      </div>

      <Tabs defaultValue="month">
        <TabsList>
          <TabsTrigger value="month">Mes</TabsTrigger>
          <TabsTrigger value="quarter">Trimestre</TabsTrigger>
          <TabsTrigger value="year">Año</TabsTrigger>
        </TabsList>

        <TabsContent value="month" className="mt-4">
          <Card className="p-6">
            <h2 className="font-heading font-semibold text-lg mb-4 flex items-center gap-2"><TrendingUp className="h-5 w-5 text-primary" />Mes en curso</h2>
            <div className="grid md:grid-cols-3 gap-3">
              <Stat label="Ingresos" value={fmtEUR(c.income_month)} accent="text-emerald-600" />
              <Stat label="Gastos" value={fmtEUR(c.expenses_month)} accent="text-red-600" />
              <Stat label="Beneficio" value={fmtEUR(c.benefit_month)} accent="text-primary" />
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="quarter" className="mt-4 space-y-4">
          <Card className="p-6">
            <h2 className="font-heading font-semibold text-lg mb-4 flex items-center gap-2"><Calculator className="h-5 w-5 text-primary" />Trimestre actual (T{data.quarter})</h2>
            <div className="grid md:grid-cols-3 gap-3 mb-6">
              <Stat label="Ingresos" value={fmtEUR(c.income_quarter)} accent="text-emerald-600" />
              <Stat label="Gastos" value={fmtEUR(c.expenses_quarter)} accent="text-red-600" />
              <Stat label="Beneficio" value={fmtEUR(c.benefit_quarter)} accent="text-primary" />
            </div>
            <div className="border-t pt-6">
              <h3 className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-3">Impuestos estimados de este trimestre</h3>
              <div className="grid md:grid-cols-2 gap-3">
                <Stat label="IVA repercutido" value={fmtEUR(tax.iva_rep)} sub="ingresos cobrados" />
                <Stat label="IVA soportado" value={fmtEUR(tax.iva_sop)} sub="gastos deducibles" />
                <Stat label="IVA a pagar (Modelo 303)" value={fmtEUR(tax.iva_a_pagar_303)} accent="text-amber-600" sub="diferencia rep − sop" />
                <Stat label="IRPF retenido en facturas" value={fmtEUR(tax.irpf_retenido)} sub="ya retenido por clientes" />
                <Stat label="IRPF estimado (Modelo 130)" value={fmtEUR(tax.irpf_130_estimado)} accent="text-amber-600" sub="20% beneficio − retenciones" />
              </div>
            </div>
          </Card>
          <Card className="p-4 bg-amber-500/5 border-amber-500/20">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
              <p className="text-sm text-muted-foreground">
                <span className="text-foreground font-semibold">Estimación informativa.</span> Los importes son aproximados. El cálculo definitivo del Modelo 130 depende de tu situación fiscal personal y deducciones aplicables. Consulta con tu asesor antes de presentar.
              </p>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="year" className="mt-4 space-y-4">
          <Card className="p-6">
            <h2 className="font-heading font-semibold text-lg mb-4">Año {data.year} · Hasta hoy</h2>
            <div className="grid md:grid-cols-3 gap-3">
              <Stat label="Ingresos" value={fmtEUR(c.income_year)} accent="text-emerald-600" />
              <Stat label="Gastos" value={fmtEUR(c.expenses_year)} accent="text-red-600" />
              <Stat label="Beneficio" value={fmtEUR(c.benefit_year)} accent="text-primary" />
            </div>
          </Card>
          <Card className="p-6 bg-primary/5 border-primary/20">
            <h2 className="font-heading font-semibold text-lg mb-4 flex items-center gap-2"><TrendingUp className="h-5 w-5 text-primary" />Proyección anual estimada</h2>
            <p className="text-sm text-muted-foreground mb-4">Basada en tu ritmo actual extrapolado a 12 meses.</p>
            <div className="grid md:grid-cols-3 gap-3 mb-4">
              <Stat label="Ingresos proyectados" value={fmtEUR(proj.income)} />
              <Stat label="Gastos proyectados" value={fmtEUR(proj.expenses)} />
              <Stat label="Beneficio proyectado" value={fmtEUR(proj.benefit)} accent="text-primary" />
            </div>
            <div className="grid md:grid-cols-3 gap-3 pt-4 border-t border-primary/20">
              <Stat label="IRPF estimado año" value={fmtEUR(proj.irpf_estimated)} accent="text-amber-600" sub="≈20% beneficio" />
              <Stat label="IVA estimado año" value={fmtEUR(proj.iva_estimated)} accent="text-amber-600" sub="extrapolado del trimestre" />
              <Stat label="Impuestos totales estim." value={fmtEUR(proj.tax_total_estimated)} accent="text-destructive" sub="IVA + IRPF" />
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
