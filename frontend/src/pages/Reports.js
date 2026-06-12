import { useEffect, useState } from "react";
import { api, fmtEUR } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { Download } from "lucide-react";
import { toast } from "sonner";

const QUARTERS = [1, 2, 3, 4];
const YEARS = [2024, 2025, 2026];

export default function Reports() {
  const [tab, setTab] = useState("quarter");
  const [year, setYear] = useState(new Date().getFullYear());
  const [quarter, setQuarter] = useState(Math.floor(new Date().getMonth() / 3) + 1);
  const [qData, setQData] = useState(null);
  const [yData, setYData] = useState(null);

  useEffect(() => {
    if (tab === "quarter")
      api.get(`/reports/quarter/${year}/${quarter}`).then((r) => setQData(r.data)).catch(() => toast.error("Error cargando reporte"));
    else
      api.get(`/reports/year/${year}`).then((r) => setYData(r.data)).catch(() => toast.error("Error cargando reporte"));
  }, [tab, year, quarter]);

  const exportCSV = (data, filename) => {
    const csv = "key,value\n" + Object.entries(data).filter(([k, v]) => typeof v === "number" || typeof v === "string").map(([k, v]) => `${k},${v}`).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6" data-testid="reports-page">
      <div>
        <h1 className="font-heading text-3xl font-bold">Reportes</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Trimestral y anual</p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="quarter">Trimestral</TabsTrigger>
            <TabsTrigger value="year">Anual</TabsTrigger>
          </TabsList>
          <div className="flex gap-2">
            <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
              <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
              <SelectContent>{YEARS.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
            </Select>
            {tab === "quarter" && (
              <Select value={String(quarter)} onValueChange={(v) => setQuarter(Number(v))}>
                <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                <SelectContent>{QUARTERS.map(q => <SelectItem key={q} value={String(q)}>T{q}</SelectItem>)}</SelectContent>
              </Select>
            )}
          </div>
        </div>

        <TabsContent value="quarter" className="mt-6 space-y-4">
          {!qData ? <Skeleton className="h-72" /> : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card className="p-5"><div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Ingresos</div><div className="num text-2xl font-bold mt-2">{fmtEUR(qData.income)}</div></Card>
                <Card className="p-5"><div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Gastos</div><div className="num text-2xl font-bold mt-2">{fmtEUR(qData.expenses)}</div></Card>
                <Card className="p-5"><div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Beneficio</div><div className="num text-2xl font-bold mt-2 text-primary">{fmtEUR(qData.benefit)}</div></Card>
                <Card className="p-5"><div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">IVA a pagar</div><div className="num text-2xl font-bold mt-2 text-amber-600">{fmtEUR(qData.iva_pay)}</div></Card>
              </div>
              <Card className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-heading font-semibold text-lg">Modelo 303 · Modelo 130 · {year} T{quarter}</h3>
                  <Button size="sm" variant="outline" onClick={() => exportCSV(qData, `reporte-T${quarter}-${year}.csv`)} data-testid="export-csv-q"><Download className="h-3.5 w-3.5 mr-1" />CSV</Button>
                </div>
                <div className="grid md:grid-cols-2 gap-3 text-sm">
                  <div className="flex justify-between p-3 rounded bg-muted/40"><span>IVA repercutido</span><span className="num font-semibold">{fmtEUR(qData.iva_rep)}</span></div>
                  <div className="flex justify-between p-3 rounded bg-muted/40"><span>IVA soportado</span><span className="num font-semibold">{fmtEUR(qData.iva_sop)}</span></div>
                  <div className="flex justify-between p-3 rounded bg-primary/10"><span className="font-semibold">IVA a liquidar (303)</span><span className="num font-bold text-primary">{fmtEUR(qData.iva_pay)}</span></div>
                  <div className="flex justify-between p-3 rounded bg-amber-500/10"><span className="font-semibold">IRPF retenido</span><span className="num font-bold text-amber-600">{fmtEUR(qData.irpf)}</span></div>
                </div>
              </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="year" className="mt-6 space-y-4">
          {!yData ? <Skeleton className="h-72" /> : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card className="p-5"><div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Total facturado</div><div className="num text-2xl font-bold mt-2">{fmtEUR(yData.income)}</div></Card>
                <Card className="p-5"><div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Total gastos</div><div className="num text-2xl font-bold mt-2">{fmtEUR(yData.expenses)}</div></Card>
                <Card className="p-5"><div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Beneficio anual</div><div className="num text-2xl font-bold mt-2 text-primary">{fmtEUR(yData.benefit)}</div></Card>
                <Card className="p-5"><div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Estimación IRPF</div><div className="num text-2xl font-bold mt-2 text-amber-600">{fmtEUR(yData.estimated_tax)}</div></Card>
              </div>
              <Card className="p-6">
                <h3 className="font-heading font-semibold text-lg mb-4">Evolución mensual</h3>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={yData.monthly}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                      <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                      <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                      <Legend />
                      <Bar dataKey="ingresos" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="gastos" fill="hsl(var(--chart-5))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
              <Card className="p-6">
                <h3 className="font-heading font-semibold text-lg mb-4">Top clientes</h3>
                {yData.top_clients.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sin datos.</p>
                ) : (
                  <div className="space-y-2">
                    {yData.top_clients.map((c, i) => (
                      <div key={i} className="flex items-center justify-between p-3 rounded bg-muted/40">
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 rounded-md bg-primary/10 text-primary flex items-center justify-center font-bold text-xs">{i + 1}</div>
                          <span className="font-medium">{c.name}</span>
                        </div>
                        <span className="num font-semibold">{fmtEUR(c.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
