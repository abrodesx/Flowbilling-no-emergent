import { useState } from "react";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileDown, Package, FileText, Receipt } from "lucide-react";
import { toast } from "sonner";

const QUARTERS = [1, 2, 3, 4];
const YEARS = [2024, 2025, 2026];

export default function Hacienda() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [quarter, setQuarter] = useState(Math.floor(new Date().getMonth() / 3) + 1);
  const [loading, setLoading] = useState(null);

  const download = async (path, filename) => {
    setLoading(path);
    try {
      const res = await api.get(path, { responseType: "blob" });
      const url = window.URL.createObjectURL(res.data);
      const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
      window.URL.revokeObjectURL(url);
      toast.success("Descargado");
    } catch (e) { toast.error("Error generando documento"); }
    finally { setLoading(null); }
  };

  return (
    <div className="space-y-6" data-testid="hacienda-page">
      <div>
        <h1 className="font-heading text-3xl font-bold">Hacienda</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Borradores oficiales de modelos AEAT y exportación para gestor</p>
      </div>

      <Card className="p-6">
        <div className="flex items-center gap-3">
          <span className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">Periodo</span>
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="w-28" data-testid="year-select"><SelectValue /></SelectTrigger>
            <SelectContent>{YEARS.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={String(quarter)} onValueChange={(v) => setQuarter(Number(v))}>
            <SelectTrigger className="w-28" data-testid="quarter-select"><SelectValue /></SelectTrigger>
            <SelectContent>{QUARTERS.map(q => <SelectItem key={q} value={String(q)}>T{q}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        <Card className="p-6">
          <div className="flex items-start gap-4 mb-4">
            <div className="h-10 w-10 rounded-md bg-primary/10 text-primary flex items-center justify-center"><FileText className="h-5 w-5" /></div>
            <div>
              <h3 className="font-heading font-semibold text-lg">Modelo 303</h3>
              <p className="text-sm text-muted-foreground">IVA - Autoliquidación trimestral</p>
            </div>
          </div>
          <Button onClick={() => download(`/hacienda/modelo-303/${year}/${quarter}`, `modelo-303-${year}-T${quarter}.pdf`)} disabled={loading === `/hacienda/modelo-303/${year}/${quarter}`} className="w-full" variant="outline" data-testid="download-303">
            <FileDown className="h-4 w-4 mr-2" />Descargar borrador 303 · T{quarter}/{year}
          </Button>
        </Card>

        <Card className="p-6">
          <div className="flex items-start gap-4 mb-4">
            <div className="h-10 w-10 rounded-md bg-amber-500/10 text-amber-600 flex items-center justify-center"><Receipt className="h-5 w-5" /></div>
            <div>
              <h3 className="font-heading font-semibold text-lg">Modelo 130</h3>
              <p className="text-sm text-muted-foreground">IRPF - Pago fraccionado trimestral</p>
            </div>
          </div>
          <Button onClick={() => download(`/hacienda/modelo-130/${year}/${quarter}`, `modelo-130-${year}-T${quarter}.pdf`)} disabled={loading === `/hacienda/modelo-130/${year}/${quarter}`} className="w-full" variant="outline" data-testid="download-130">
            <FileDown className="h-4 w-4 mr-2" />Descargar borrador 130 · T{quarter}/{year}
          </Button>
        </Card>

        <Card className="p-6">
          <div className="flex items-start gap-4 mb-4">
            <div className="h-10 w-10 rounded-md bg-emerald-500/10 text-emerald-600 flex items-center justify-center"><FileText className="h-5 w-5" /></div>
            <div>
              <h3 className="font-heading font-semibold text-lg">Modelo 390</h3>
              <p className="text-sm text-muted-foreground">IVA - Resumen anual ({year})</p>
            </div>
          </div>
          <Button onClick={() => download(`/hacienda/modelo-390/${year}`, `modelo-390-${year}.pdf`)} disabled={loading === `/hacienda/modelo-390/${year}`} className="w-full" variant="outline" data-testid="download-390">
            <FileDown className="h-4 w-4 mr-2" />Descargar resumen anual {year}
          </Button>
        </Card>

        <Card className="p-6 bg-primary/5 border-primary/20">
          <div className="flex items-start gap-4 mb-4">
            <div className="h-10 w-10 rounded-md bg-primary text-primary-foreground flex items-center justify-center"><Package className="h-5 w-5" /></div>
            <div>
              <h3 className="font-heading font-semibold text-lg">Preparar trimestre</h3>
              <p className="text-sm text-muted-foreground">ZIP completo: libros + modelos + facturas + resumen</p>
            </div>
          </div>
          <Button onClick={() => download(`/hacienda/preparar-trimestre/${year}/${quarter}`, `trimestre-${year}-T${quarter}.zip`)} disabled={loading === `/hacienda/preparar-trimestre/${year}/${quarter}`} className="w-full" data-testid="download-zip">
            <Package className="h-4 w-4 mr-2" />Descargar ZIP · T{quarter}/{year}
          </Button>
        </Card>
      </div>

      <Card className="p-4 bg-amber-500/5 border-amber-500/20">
        <p className="text-sm text-muted-foreground"><span className="text-foreground font-semibold">⚠️ Borradores no oficiales.</span> Estos PDFs se generan a partir de tus datos para revisión y referencia. No tienen validez fiscal y no sustituyen a la presentación oficial vía AEAT. Consulta con tu asesor antes de presentar.</p>
      </Card>
    </div>
  );
}
