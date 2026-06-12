import { useState } from "react";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Upload, Download, FileSpreadsheet, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

const EXPORTS = [
  { key: "clients", label: "Clientes", desc: "Todos tus clientes con NIF, dirección y notas" },
  { key: "invoices", label: "Facturas", desc: "Todas las facturas emitidas con totales y estado" },
  { key: "expenses", label: "Gastos", desc: "Histórico de gastos con proveedor, IVA y categoría" },
];

const IMPORTS = [
  { key: "clients", label: "Clientes", required: "name", optional: "company, nif, address, email, phone, notes" },
  { key: "invoices", label: "Facturas", required: "client_name | client_nif, issue_date, total", optional: "number, series, due_date, status, subtotal, iva_total, irpf_total, description, notes" },
  { key: "expenses", label: "Gastos", required: "date, supplier", optional: "description, category, subtotal, iva, total, supplier_nif, notes" },
];

export default function ImportExport() {
  const [busy, setBusy] = useState(null);
  const [results, setResults] = useState({});

  const downloadExport = async (key) => {
    setBusy(`export-${key}`);
    try {
      const res = await api.get(`/export/${key}.csv`, { responseType: "blob" });
      const url = window.URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url; a.download = `${key}.csv`; a.click();
      window.URL.revokeObjectURL(url);
      toast.success(`CSV de ${key} descargado`);
    } catch (e) {
      toast.error("Error exportando");
    } finally { setBusy(null); }
  };

  const upload = async (key, file) => {
    if (!file) return;
    setBusy(`import-${key}`);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post(`/import/${key}`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      setResults({ ...results, [key]: data });
      toast.success(`${data.created} registros importados · ${data.skipped} saltados`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Error en la importación");
    } finally { setBusy(null); }
  };

  return (
    <div className="space-y-8" data-testid="import-export-page">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-md bg-primary/10 text-primary flex items-center justify-center"><FileSpreadsheet className="h-5 w-5" /></div>
        <div>
          <h1 className="font-heading text-3xl font-bold">Importar / Exportar</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Migra desde Excel u otros programas y descarga tus datos en CSV.</p>
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="font-heading font-semibold text-lg flex items-center gap-2"><Download className="h-4 w-4" /> Exportar</h2>
        <div className="grid md:grid-cols-3 gap-3">
          {EXPORTS.map(e => (
            <Card key={e.key} className="p-5 space-y-3">
              <div>
                <div className="font-semibold">{e.label}</div>
                <div className="text-xs text-muted-foreground mt-1">{e.desc}</div>
              </div>
              <Button onClick={() => downloadExport(e.key)} disabled={busy === `export-${e.key}`} size="sm" data-testid={`export-${e.key}`}>
                <Download className="h-3.5 w-3.5 mr-1.5" />Descargar CSV
              </Button>
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-heading font-semibold text-lg flex items-center gap-2"><Upload className="h-4 w-4" /> Importar</h2>
        <div className="grid md:grid-cols-3 gap-3">
          {IMPORTS.map(im => (
            <Card key={im.key} className="p-5 space-y-3">
              <div>
                <div className="font-semibold">{im.label}</div>
                <div className="text-[11px] text-muted-foreground mt-1">
                  <b>Obligatorio:</b> {im.required}<br />
                  <b>Opcional:</b> {im.optional}
                </div>
              </div>
              <input
                type="file"
                accept=".csv,text/csv"
                data-testid={`import-${im.key}`}
                onChange={(e) => upload(im.key, e.target.files?.[0])}
                disabled={busy === `import-${im.key}`}
                className="text-xs w-full file:mr-2 file:rounded-md file:border-0 file:bg-primary/10 file:text-primary file:px-2 file:py-1 file:text-xs file:font-semibold hover:file:bg-primary/20 file:cursor-pointer"
              />
              {results[im.key] && (
                <div className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {results[im.key].created} creados · {results[im.key].skipped} saltados
                </div>
              )}
            </Card>
          ))}
        </div>
        <Card className="p-3 bg-primary/5 border-primary/20 text-xs text-muted-foreground">
          <b>Formato CSV:</b> UTF-8, separador por comas, primera fila = nombres de columna. Acepta nombres en español (cliente, fecha, total, etc.) o inglés.
        </Card>
      </section>
    </div>
  );
}
