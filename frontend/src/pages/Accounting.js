import { useEffect, useState } from "react";
import { api, fmtEUR, fmtDate } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Download, BookOpen } from "lucide-react";
import { toast } from "sonner";

const QUARTERS = [{ v: "all", l: "Todo el año" }, { v: "1", l: "T1 (Ene-Mar)" }, { v: "2", l: "T2 (Abr-Jun)" }, { v: "3", l: "T3 (Jul-Sep)" }, { v: "4", l: "T4 (Oct-Dic)" }];
const YEARS = [2024, 2025, 2026];

export default function Accounting() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [quarter, setQuarter] = useState("all");
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("ingresos");

  useEffect(() => {
    setData(null);
    const params = new URLSearchParams({ year });
    if (quarter !== "all") params.set("quarter", quarter);
    api.get(`/accounting/books?${params.toString()}`).then((r) => setData(r.data)).catch(() => toast.error("Error cargando libros"));
  }, [year, quarter]);

  const csv = (rows, name) => {
    if (!rows.length) return toast.error("Sin datos para exportar");
    const headers = Object.keys(rows[0]);
    const body = rows.map(r => headers.map(h => `"${String(r[h] ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([headers.join(",") + "\n" + body], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  };

  const periodLabel = quarter === "all" ? `${year}` : `${year} · T${quarter}`;

  return (
    <div className="space-y-6" data-testid="accounting-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-3xl font-bold">Contabilidad</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Libros oficiales · Ingresos · Gastos · IVA · {periodLabel}</p>
        </div>
        <div className="flex gap-2">
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="w-28" data-testid="year-select"><SelectValue /></SelectTrigger>
            <SelectContent>{YEARS.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={quarter} onValueChange={setQuarter}>
            <SelectTrigger className="w-40" data-testid="quarter-select"><SelectValue /></SelectTrigger>
            <SelectContent>{QUARTERS.map(q => <SelectItem key={q.v} value={q.v}>{q.l}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      {!data ? <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-24" />)}</div> : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="p-4"><div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Ingresos (base)</div><div className="num text-xl font-bold mt-1">{fmtEUR(data.totals.ingresos_base)}</div></Card>
            <Card className="p-4"><div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Gastos (base)</div><div className="num text-xl font-bold mt-1">{fmtEUR(data.totals.gastos_base)}</div></Card>
            <Card className="p-4"><div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">IVA a liquidar</div><div className="num text-xl font-bold mt-1 text-amber-600">{fmtEUR(data.totals.iva_a_liquidar)}</div></Card>
            <Card className="p-4"><div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Beneficio</div><div className="num text-xl font-bold mt-1 text-primary">{fmtEUR(data.totals.beneficio)}</div></Card>
          </div>

          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="grid grid-cols-4 w-full max-w-2xl">
              <TabsTrigger value="ingresos">Ingresos</TabsTrigger>
              <TabsTrigger value="gastos">Gastos</TabsTrigger>
              <TabsTrigger value="iva-rep">IVA repercutido</TabsTrigger>
              <TabsTrigger value="iva-sop">IVA soportado</TabsTrigger>
            </TabsList>

            <TabsContent value="ingresos" className="mt-4">
              <Card>
                <div className="px-4 py-3 flex items-center justify-between border-b border-border">
                  <h3 className="font-semibold flex items-center gap-2"><BookOpen className="h-4 w-4" />Libro de ingresos</h3>
                  <Button size="sm" variant="outline" onClick={() => csv(data.libro_ingresos, `ingresos-${periodLabel}.csv`)}><Download className="h-3.5 w-3.5 mr-1" />CSV</Button>
                </div>
                <BookTable rows={data.libro_ingresos} columns={[
                  { k: "date", l: "Fecha", fmt: fmtDate },
                  { k: "number", l: "Número" },
                  { k: "client", l: "Cliente" },
                  { k: "nif", l: "NIF" },
                  { k: "type", l: "Tipo" },
                  { k: "base", l: "Base", num: true, money: true },
                  { k: "iva", l: "IVA", num: true, money: true },
                  { k: "irpf", l: "IRPF", num: true, money: true },
                  { k: "total", l: "Total", num: true, money: true, bold: true },
                ]} totals={[null, null, null, null, "TOTAL", data.totals.ingresos_base, data.totals.ingresos_iva, data.totals.ingresos_irpf, data.totals.ingresos_total]} />
              </Card>
            </TabsContent>

            <TabsContent value="gastos" className="mt-4">
              <Card>
                <div className="px-4 py-3 flex items-center justify-between border-b border-border">
                  <h3 className="font-semibold flex items-center gap-2"><BookOpen className="h-4 w-4" />Libro de gastos</h3>
                  <Button size="sm" variant="outline" onClick={() => csv(data.libro_gastos, `gastos-${periodLabel}.csv`)}><Download className="h-3.5 w-3.5 mr-1" />CSV</Button>
                </div>
                <BookTable rows={data.libro_gastos} columns={[
                  { k: "date", l: "Fecha", fmt: fmtDate },
                  { k: "supplier", l: "Proveedor" },
                  { k: "description", l: "Descripción" },
                  { k: "category", l: "Categoría" },
                  { k: "base", l: "Base", num: true, money: true },
                  { k: "iva", l: "IVA", num: true, money: true },
                  { k: "total", l: "Total", num: true, money: true, bold: true },
                  { k: "method", l: "Método" },
                ]} totals={[null, null, null, "TOTAL", data.totals.gastos_base, data.totals.gastos_iva, data.totals.gastos_total, null]} />
              </Card>
            </TabsContent>

            <TabsContent value="iva-rep" className="mt-4">
              <Card>
                <div className="px-4 py-3 flex items-center justify-between border-b border-border">
                  <h3 className="font-semibold">IVA repercutido (modelo 303)</h3>
                  <Button size="sm" variant="outline" onClick={() => csv(data.iva_rep_lines, `iva-rep-${periodLabel}.csv`)}><Download className="h-3.5 w-3.5 mr-1" />CSV</Button>
                </div>
                <BookTable rows={data.iva_rep_lines} columns={[
                  { k: "date", l: "Fecha", fmt: fmtDate },
                  { k: "number", l: "Número" },
                  { k: "client", l: "Cliente" },
                  { k: "base", l: "Base", num: true, money: true },
                  { k: "iva", l: "IVA repercutido", num: true, money: true, bold: true },
                ]} totals={[null, null, "TOTAL", data.totals.ingresos_base, data.totals.iva_rep]} />
              </Card>
            </TabsContent>

            <TabsContent value="iva-sop" className="mt-4">
              <Card>
                <div className="px-4 py-3 flex items-center justify-between border-b border-border">
                  <h3 className="font-semibold">IVA soportado (modelo 303)</h3>
                  <Button size="sm" variant="outline" onClick={() => csv(data.iva_sop_lines, `iva-sop-${periodLabel}.csv`)}><Download className="h-3.5 w-3.5 mr-1" />CSV</Button>
                </div>
                <BookTable rows={data.iva_sop_lines} columns={[
                  { k: "date", l: "Fecha", fmt: fmtDate },
                  { k: "supplier", l: "Proveedor" },
                  { k: "base", l: "Base", num: true, money: true },
                  { k: "iva", l: "IVA soportado", num: true, money: true, bold: true },
                ]} totals={[null, "TOTAL", data.totals.gastos_base, data.totals.iva_sop]} />
              </Card>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

function BookTable({ rows, columns, totals }) {
  if (!rows.length) return <div className="p-12 text-center text-muted-foreground">Sin movimientos en este periodo.</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/40">
          <tr className="text-left text-muted-foreground">{columns.map(c => <th key={c.k} className={`px-4 py-3 font-medium ${c.num ? "text-right" : ""}`}>{c.l}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-border hover:bg-muted/30">
              {columns.map(c => (
                <td key={c.k} className={`px-4 py-2.5 ${c.num ? "text-right num" : ""} ${c.bold ? "font-semibold" : ""}`}>
                  {c.fmt ? c.fmt(r[c.k]) : c.money ? fmtEUR(r[c.k]) : (r[c.k] || "—")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {totals && (
          <tfoot className="bg-primary/5 font-semibold">
            <tr>
              {totals.map((t, i) => (
                <td key={i} className={`px-4 py-3 ${columns[i]?.num ? "text-right num text-primary" : "text-muted-foreground uppercase text-xs tracking-wider"}`}>
                  {t === null ? "" : columns[i]?.money ? fmtEUR(t) : t}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
