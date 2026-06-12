import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  LayoutDashboard, FileText, Users, Receipt, BarChart3, Calendar, Settings,
  FileSignature, BookOpen, Sparkles, Landmark, Briefcase, Clock, FileDown,
  Plus, Activity, ShieldCheck, QrCode, FileSpreadsheet, History, SlidersHorizontal, Mail, UserCheck
} from "lucide-react";

const ACTIONS = [
  { icon: Plus, label: "Nueva factura", to: "/app/facturas/nueva", group: "Crear" },
  { icon: Plus, label: "Nuevo presupuesto", to: "/app/presupuestos/nuevo", group: "Crear" },
  { icon: Plus, label: "Nuevo cliente", to: "/app/clientes", group: "Crear" },
  { icon: LayoutDashboard, label: "Dashboard", to: "/app", group: "Ir a" },
  { icon: FileText, label: "Facturas", to: "/app/facturas", group: "Ir a" },
  { icon: FileSignature, label: "Presupuestos", to: "/app/presupuestos", group: "Ir a" },
  { icon: Users, label: "Clientes", to: "/app/clientes", group: "Ir a" },
  { icon: Receipt, label: "Gastos", to: "/app/gastos", group: "Ir a" },
  { icon: Briefcase, label: "Proyectos", to: "/app/proyectos", group: "Ir a" },
  { icon: Clock, label: "Horas", to: "/app/horas", group: "Ir a" },
  { icon: BookOpen, label: "Contabilidad", to: "/app/contabilidad", group: "Ir a" },
  { icon: FileDown, label: "Hacienda", to: "/app/hacienda", group: "Ir a" },
  { icon: QrCode, label: "Verifactu", to: "/app/verifactu", group: "Ir a" },
  { icon: SlidersHorizontal, label: "Búsqueda avanzada", to: "/app/buscar", group: "Ir a" },
  { icon: FileSpreadsheet, label: "Importar/Exportar", to: "/app/importar", group: "Ir a" },
  { icon: Sparkles, label: "Importar con IA", to: "/app/importar-ia", group: "Ir a" },
  { icon: History, label: "Auditoría", to: "/app/auditoria", group: "Ir a" },
  { icon: Mail, label: "Plantillas email", to: "/app/plantillas-email", group: "Ir a" },
  { icon: UserCheck, label: "Portal gestor", to: "/app/gestor", group: "Ir a" },
  { icon: FileSignature, label: "Firma digital", to: "/app/firma", group: "Ir a" },
  { icon: Landmark, label: "Panel fiscal", to: "/app/panel-fiscal", group: "Ir a" },
  { icon: Sparkles, label: "Asistente IA", to: "/app/asistente", group: "Ir a" },
  { icon: ShieldCheck, label: "Modo Asesor", to: "/app/asesor", group: "Ir a" },
  { icon: Activity, label: "Salud del negocio", to: "/app/salud", group: "Ir a" },
  { icon: BarChart3, label: "Reportes", to: "/app/reportes", group: "Ir a" },
  { icon: Calendar, label: "Calendario fiscal", to: "/app/calendario", group: "Ir a" },
  { icon: Settings, label: "Configuración", to: "/app/configuracion", group: "Ir a" },
];

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const go = (to) => { navigate(to); setOpen(false); };

  const groups = [...new Set(ACTIONS.map((a) => a.group))];

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <DialogTitle className="sr-only">Paleta de comandos</DialogTitle>
      <DialogDescription className="sr-only">Busca y navega rápidamente por la aplicación</DialogDescription>
      <CommandInput placeholder="Buscar acción... (⌘K)" data-testid="cmd-input" />
      <CommandList>
        <CommandEmpty>Sin resultados.</CommandEmpty>
        {groups.map((g) => (
          <CommandGroup key={g} heading={g}>
            {ACTIONS.filter((a) => a.group === g).map((a) => (
              <CommandItem key={a.to + a.label} onSelect={() => go(a.to)}>
                <a.icon className="h-4 w-4 mr-2" />{a.label}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
