import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Logo } from "@/components/Logo";
import { CheckCircle2, XCircle, FileSignature } from "lucide-react";
import { toast } from "sonner";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function PublicQuote() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [comment, setComment] = useState("");
  const [signature, setSignature] = useState("");
  const [done, setDone] = useState(null);

  useEffect(() => {
    axios.get(`${API}/public/quote/${token}`).then((r) => setData(r.data)).catch(() => setData(false));
  }, [token]);

  const act = async (action) => {
    try {
      const { data: r } = await axios.post(`${API}/public/quote/${token}/action`, { action, signature, comment });
      setDone(r.status);
    } catch (e) { toast.error("Error procesando"); }
  };

  if (data === null) return <div className="min-h-screen flex items-center justify-center"><div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" /></div>;
  if (data === false) return <div className="min-h-screen flex items-center justify-center"><Card className="p-8 text-center max-w-md"><XCircle className="h-10 w-10 text-destructive mx-auto mb-3" /><h2 className="font-heading text-xl font-bold">Presupuesto no disponible</h2><p className="text-muted-foreground text-sm mt-2">El enlace ha caducado o no es válido.</p></Card></div>;

  const q = data.quote;
  const iss = data.issuer || {};

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-muted/30">
        <Card className="p-12 text-center max-w-md">
          {done === "aceptado" ? <CheckCircle2 className="h-16 w-16 text-emerald-600 mx-auto mb-4" /> : <XCircle className="h-16 w-16 text-destructive mx-auto mb-4" />}
          <h2 className="font-heading text-2xl font-bold">{done === "aceptado" ? "¡Presupuesto aceptado!" : "Presupuesto rechazado"}</h2>
          <p className="text-muted-foreground text-sm mt-3">{done === "aceptado" ? `Gracias. ${iss.fiscal_name || iss.name || "El emisor"} ha sido notificado.` : "El emisor ha sido notificado de tu decisión."}</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b border-border bg-card">
        <div className="max-w-3xl mx-auto px-6 h-16 flex items-center"><Logo /></div>
      </header>
      <main className="max-w-3xl mx-auto p-6 py-12 space-y-6">
        <div className="text-center">
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary">
            <FileSignature className="h-3 w-3" />Presupuesto {q.number}
          </span>
          <h1 className="font-heading text-3xl font-bold mt-3">{iss.fiscal_name || iss.name || "—"}</h1>
          <p className="text-sm text-muted-foreground mt-1">te envía un presupuesto para tu revisión</p>
        </div>

        <Card className="p-6">
          <div className="grid md:grid-cols-2 gap-4 mb-6 pb-6 border-b border-border">
            <div><div className="text-xs uppercase text-muted-foreground font-semibold">Para</div><div className="font-medium mt-1">{q.client_name}</div><div className="text-sm text-muted-foreground">{q.client_nif}</div></div>
            <div className="md:text-right"><div className="text-xs uppercase text-muted-foreground font-semibold">Fecha emisión</div><div className="font-medium mt-1">{q.issue_date}</div>{q.valid_until && <div className="text-xs text-muted-foreground mt-1">Válido hasta: {q.valid_until}</div>}</div>
          </div>

          <table className="w-full text-sm mb-6">
            <thead><tr className="text-left text-muted-foreground border-b border-border"><th className="pb-2 font-medium">Descripción</th><th className="pb-2 font-medium text-right">Total</th></tr></thead>
            <tbody>{q.items?.map((it, i) => (
              <tr key={i} className="border-b border-border last:border-0"><td className="py-3">{it.description}<div className="text-xs text-muted-foreground">{it.quantity} × {it.price.toFixed(2)}€ · IVA {it.iva}%</div></td><td className="py-3 num text-right font-semibold">{(it.quantity * it.price * (1 + it.iva/100)).toFixed(2)}€</td></tr>
            ))}</tbody>
          </table>

          <div className="flex justify-between text-lg pt-4 border-t border-border">
            <span className="font-semibold">Total</span>
            <span className="num font-bold text-primary text-2xl">{q.total?.toFixed(2)}€</span>
          </div>

          {q.notes && <div className="mt-6 p-4 rounded bg-muted/40 text-sm"><b>Observaciones:</b> {q.notes}</div>}
        </Card>

        {q.status === "pendiente" ? (
          <Card className="p-6 space-y-4">
            <h3 className="font-heading font-semibold text-lg">Tu respuesta</h3>
            <div>
              <label className="text-sm font-medium block mb-1">Firma (tu nombre completo) — opcional</label>
              <input type="text" value={signature} onChange={(e) => setSignature(e.target.value)} placeholder="Ej: Juan Pérez García" className="w-full px-3 py-2 border border-input rounded-md bg-background" />
            </div>
            <div>
              <label className="text-sm font-medium block mb-1">Comentario — opcional</label>
              <Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Cualquier observación o duda..." />
            </div>
            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <Button onClick={() => act("accept")} className="flex-1 bg-emerald-600 hover:bg-emerald-700" size="lg" data-testid="accept-quote"><CheckCircle2 className="h-4 w-4 mr-2" />Aceptar presupuesto</Button>
              <Button onClick={() => act("reject")} variant="outline" size="lg" data-testid="reject-quote"><XCircle className="h-4 w-4 mr-2" />Rechazar</Button>
            </div>
          </Card>
        ) : (
          <Card className="p-6 text-center bg-muted/40">
            <p className="text-muted-foreground">Este presupuesto ya ha sido <b>{q.status}</b>.</p>
          </Card>
        )}

        <p className="text-xs text-center text-muted-foreground">Powered by FakturaFlow</p>
      </main>
    </div>
  );
}
