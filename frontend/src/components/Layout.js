import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, FileText, Users, Receipt, BarChart3, Calendar,
  Settings as SettingsIcon, LogOut, Sun, Moon, Search, Menu, X,
  FileSignature, BookOpen, Sparkles, Landmark, Briefcase, Clock, FileDown, ChevronDown, Building2,
  ShieldCheck, Activity, QrCode, FileSpreadsheet, History, SlidersHorizontal, Mail, UserCheck
} from "lucide-react";
import { useProfile } from "@/contexts/ProfileContext";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import ReminderBell from "@/components/ReminderBell";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { api } from "@/lib/api";

const NAV = [
  { to: "/app", icon: LayoutDashboard, label: "Dashboard", end: true, id: "nav-dashboard" },
  { to: "/app/presupuestos", icon: FileSignature, label: "Presupuestos", id: "nav-quotes" },
  { to: "/app/facturas", icon: FileText, label: "Facturas", id: "nav-invoices" },
  { to: "/app/clientes", icon: Users, label: "Clientes", id: "nav-clients" },
  { to: "/app/gastos", icon: Receipt, label: "Gastos", id: "nav-expenses" },
  { to: "/app/proyectos", icon: Briefcase, label: "Proyectos", id: "nav-projects" },
  { to: "/app/horas", icon: Clock, label: "Horas", id: "nav-time" },
  { to: "/app/contabilidad", icon: BookOpen, label: "Contabilidad", id: "nav-accounting" },
  { to: "/app/hacienda", icon: FileDown, label: "Hacienda", id: "nav-hacienda" },
  { to: "/app/verifactu", icon: QrCode, label: "Verifactu", id: "nav-verifactu" },
  { to: "/app/buscar", icon: SlidersHorizontal, label: "Búsqueda avanzada", id: "nav-search" },
  { to: "/app/importar", icon: FileSpreadsheet, label: "Importar/Exportar", id: "nav-import" },
  { to: "/app/importar-ia", icon: Sparkles, label: "Importar con IA", id: "nav-ai-import" },
  { to: "/app/auditoria", icon: History, label: "Auditoría", id: "nav-audit" },
  { to: "/app/plantillas-email", icon: Mail, label: "Plantillas email", id: "nav-emails" },
  { to: "/app/gestor", icon: UserCheck, label: "Portal gestor", id: "nav-gestor" },
  { to: "/app/panel-fiscal", icon: Landmark, label: "Panel fiscal", id: "nav-fiscal" },
  { to: "/app/asistente", icon: Sparkles, label: "Asistente IA", id: "nav-ai" },
  { to: "/app/asesor", icon: ShieldCheck, label: "Modo Asesor", id: "nav-advisor" },
  { to: "/app/salud", icon: Activity, label: "Salud del negocio", id: "nav-health" },
  { to: "/app/reportes", icon: BarChart3, label: "Reportes", id: "nav-reports" },
  { to: "/app/calendario", icon: Calendar, label: "Calendario fiscal", id: "nav-calendar" },
  { to: "/app/configuracion", icon: SettingsIcon, label: "Configuración", id: "nav-settings" },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState(null);

  const onSearch = async (val) => {
    setQ(val);
    if (val.length < 2) return setResults(null);
    try {
      const { data } = await api.get(`/search?q=${encodeURIComponent(val)}`);
      setResults(data);
    } catch {}
  };

  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar */}
      <aside
        className={`${
          open ? "translate-x-0" : "-translate-x-full"
        } md:translate-x-0 fixed md:sticky md:top-0 z-40 h-screen w-64 bg-card border-r border-border flex flex-col transition-transform`}
        data-testid="sidebar"
      >
        <div className="h-16 px-5 flex items-center border-b border-border">
          <Logo />
        </div>
        <ProfileSwitcher />
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              data-testid={n.id}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                  isActive
                    ? "bg-primary/10 text-primary font-semibold"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`
              }
            >
              <n.icon className="h-4 w-4" />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-border space-y-2">
          <div className="px-2 py-2 flex items-center gap-3">
            <div className="h-8 w-8 rounded-full bg-primary/15 flex items-center justify-center text-xs font-bold text-primary">
              {(user?.name || "U").slice(0, 1).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{user?.name}</div>
              <div className="text-xs text-muted-foreground truncate">{user?.email}</div>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => { await logout(); navigate("/login"); }}
            className="w-full justify-start text-muted-foreground hover:text-foreground"
            data-testid="logout-button"
          >
            <LogOut className="h-4 w-4 mr-2" />Cerrar sesión
          </Button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 sticky top-0 z-30 bg-background/80 backdrop-blur border-b border-border px-4 md:px-6 flex items-center gap-3">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setOpen(!open)} data-testid="mobile-menu">
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar facturas, clientes, gastos…"
              className="pl-9 bg-muted/40 border-transparent focus:bg-background"
              value={q}
              onChange={(e) => onSearch(e.target.value)}
              data-testid="global-search"
            />
            {results && q.length >= 2 && (
              <div className="absolute top-12 left-0 right-0 bg-popover border border-border rounded-lg shadow-lg p-2 max-h-80 overflow-y-auto z-50">
                {(["clients", "invoices", "expenses"]).every((k) => !results[k]?.length) && (
                  <div className="text-sm text-muted-foreground p-3">Sin resultados</div>
                )}
                {results.clients?.map((c) => (
                  <button key={c.id} onClick={() => { navigate("/app/clientes"); setQ(""); setResults(null); }} className="w-full text-left p-2 hover:bg-muted rounded text-sm">
                    <span className="text-xs uppercase text-muted-foreground mr-2">Cliente</span>{c.name}
                  </button>
                ))}
                {results.invoices?.map((i) => (
                  <button key={i.id} onClick={() => { navigate(`/app/facturas/${i.id}`); setQ(""); setResults(null); }} className="w-full text-left p-2 hover:bg-muted rounded text-sm">
                    <span className="text-xs uppercase text-muted-foreground mr-2">Factura</span>{i.number} · {i.client_name}
                  </button>
                ))}
                {results.expenses?.map((e) => (
                  <button key={e.id} onClick={() => { navigate("/app/gastos"); setQ(""); setResults(null); }} className="w-full text-left p-2 hover:bg-muted rounded text-sm">
                    <span className="text-xs uppercase text-muted-foreground mr-2">Gasto</span>{e.description}
                  </button>
                ))}
              </div>
            )}
          </div>
          <Button variant="ghost" size="icon" onClick={toggle} data-testid="theme-toggle" aria-label="Cambiar tema">
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
          <ReminderBell />
        </header>
        <main className="flex-1 p-4 md:p-8 max-w-7xl mx-auto w-full animate-fade-in">
          <Outlet />
        </main>
      </div>

      {open && <div className="fixed inset-0 bg-black/50 z-30 md:hidden" onClick={() => setOpen(false)} />}
    </div>
  );
}

function ProfileSwitcher() {
  const { profiles, active, setActive } = useProfile() || {};
  if (!active) return null;
  return (
    <div className="px-3 py-2 border-b border-border">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="w-full flex items-center gap-2 px-2 py-2 rounded-md hover:bg-muted text-left" data-testid="profile-switcher">
            <div className="h-7 w-7 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0"><Building2 className="h-3.5 w-3.5" /></div>
            <div className="flex-1 min-w-0">
              <div className="text-[10px] uppercase text-muted-foreground tracking-wider">Perfil activo</div>
              <div className="text-sm font-semibold truncate">{active.name}</div>
            </div>
            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel>Cambiar perfil</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {profiles?.map((p) => (
            <DropdownMenuItem key={p.id} onClick={() => { setActive(p.id); window.location.reload(); }} data-testid={`profile-option-${p.id}`}>
              <Building2 className="h-3.5 w-3.5 mr-2" />
              {p.name}
              {p.is_default && <span className="ml-auto text-[10px] text-muted-foreground">Por defecto</span>}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <a href="/app/configuracion" className="cursor-pointer"><SettingsIcon className="h-3.5 w-3.5 mr-2" />Gestionar perfiles</a>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
