import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";
import { ArrowRight, Sparkles, FileText, Receipt, BarChart3, Calendar, Shield, Zap } from "lucide-react";

const FEATURES = [
  { icon: FileText, title: "Facturas profesionales", text: "Crea, envía y exporta a PDF en segundos. Series, IVA, IRPF y descuentos." },
  { icon: Receipt, title: "OCR de tickets con IA", text: "Sube una foto y la IA extrae importe, IVA y comercio automáticamente." },
  { icon: BarChart3, title: "Reportes trimestrales", text: "303, 130, 111 listos. Resumen anual con ranking de clientes." },
  { icon: Calendar, title: "Calendario fiscal", text: "Modelos y vencimientos del año fiscal español, sin sorpresas." },
  { icon: Shield, title: "Multi-dispositivo", text: "Sincroniza en tiempo real entre web, móvil y escritorio." },
  { icon: Zap, title: "Asistente IA", text: "Resúmenes, sugerencias de gastos y predicción de impuestos." },
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border sticky top-0 z-30 bg-background/80 backdrop-blur">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Logo />
          <div className="flex items-center gap-2">
            <Link to="/login"><Button variant="ghost" size="sm" data-testid="nav-login">Entrar</Button></Link>
            <Link to="/registro"><Button size="sm" data-testid="nav-register">Empezar gratis</Button></Link>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="absolute inset-0 grid-pattern opacity-40" />
        <div className="relative max-w-5xl mx-auto px-6 pt-20 pb-24 md:pt-32 md:pb-36 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-border bg-card text-xs font-medium mb-6">
            <Sparkles className="h-3 w-3 text-primary" />
            <span>OCR con IA · Reportes automáticos · 100% en español</span>
          </div>
          <h1 className="font-heading text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.05]">
            Facturación para autónomos<br />
            <span className="text-primary">sin complicaciones.</span>
          </h1>
          <p className="mt-6 text-lg text-muted-foreground max-w-2xl mx-auto">
            FakturaFlow es la suite todo-en-uno para gestionar facturas, gastos e impuestos en España.
            Diseñada para que dediques menos tiempo a Hacienda y más a tu negocio.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <Link to="/registro">
              <Button size="lg" className="gap-2" data-testid="hero-cta">
                Crear cuenta gratis <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link to="/login"><Button size="lg" variant="outline">Ver demo</Button></Link>
          </div>
          <div className="mt-16 grid grid-cols-3 gap-8 max-w-md mx-auto text-center">
            <div><div className="num text-2xl font-bold">+12k</div><div className="text-xs text-muted-foreground">Facturas/mes</div></div>
            <div><div className="num text-2xl font-bold">98%</div><div className="text-xs text-muted-foreground">Precisión OCR</div></div>
            <div><div className="num text-2xl font-bold">€0</div><div className="text-xs text-muted-foreground">Plan inicial</div></div>
          </div>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-20">
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="border border-border bg-card rounded-lg p-6 hover:-translate-y-0.5 hover:shadow-md transition-all">
              <div className="h-10 w-10 rounded-md bg-primary/10 text-primary flex items-center justify-center mb-4">
                <f.icon className="h-5 w-5" />
              </div>
              <h3 className="font-heading font-semibold text-lg mb-1">{f.title}</h3>
              <p className="text-sm text-muted-foreground">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <Logo />
          <p className="text-xs text-muted-foreground">© 2026 FakturaFlow. Hecho en España.</p>
        </div>
      </footer>
    </div>
  );
}
