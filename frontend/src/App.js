import "@/App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { ProfileProvider } from "@/contexts/ProfileContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import Layout from "@/components/Layout";
import Landing from "@/pages/Landing";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import Dashboard from "@/pages/Dashboard";
import Invoices from "@/pages/Invoices";
import InvoiceEditor from "@/pages/InvoiceEditor";
import Clients from "@/pages/Clients";
import Expenses from "@/pages/Expenses";
import Reports from "@/pages/Reports";
import FiscalCalendar from "@/pages/FiscalCalendar";
import SettingsPage from "@/pages/Settings";
import Quotes from "@/pages/Quotes";
import QuoteEditor from "@/pages/QuoteEditor";
import Accounting from "@/pages/Accounting";
import FiscalPanel from "@/pages/FiscalPanel";
import AIAssistant from "@/pages/AIAssistant";
import Projects from "@/pages/Projects";
import ProjectDetail from "@/pages/ProjectDetail";
import TimeTracking from "@/pages/TimeTracking";
import Hacienda from "@/pages/Hacienda";
import Verifactu from "@/pages/Verifactu";
import ImportExport from "@/pages/ImportExport";
import AdvancedSearch from "@/pages/AdvancedSearch";
import Audit from "@/pages/Audit";
import EmailTemplates from "@/pages/EmailTemplates";
import Gestor from "@/pages/Gestor";
import GestorPortal from "@/pages/GestorPortal";
import DigitalSignature from "@/pages/DigitalSignature";
import AIImport from "@/pages/AIImport";
import PublicQuote from "@/pages/PublicQuote";
import BusinessHealth from "@/pages/BusinessHealth";
import Advisor from "@/pages/Advisor";
import CommandPalette from "@/components/CommandPalette";

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <ProfileProvider>
          <BrowserRouter>
            <Toaster richColors position="top-right" />
            <CommandPalette />
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/login" element={<Login />} />
              <Route path="/registro" element={<Register />} />
              <Route path="/public/quote/:token" element={<PublicQuote />} />
              <Route path="/gestor/:token" element={<GestorPortal />} />
              <Route path="/app" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
                <Route index element={<Dashboard />} />
                <Route path="facturas" element={<Invoices />} />
                <Route path="facturas/nueva" element={<InvoiceEditor />} />
                <Route path="facturas/:id" element={<InvoiceEditor />} />
                <Route path="presupuestos" element={<Quotes />} />
                <Route path="presupuestos/nuevo" element={<QuoteEditor />} />
                <Route path="presupuestos/:id" element={<QuoteEditor />} />
                <Route path="clientes" element={<Clients />} />
                <Route path="gastos" element={<Expenses />} />
                <Route path="proyectos" element={<Projects />} />
                <Route path="proyectos/:id" element={<ProjectDetail />} />
                <Route path="horas" element={<TimeTracking />} />
                <Route path="contabilidad" element={<Accounting />} />
                <Route path="hacienda" element={<Hacienda />} />
                <Route path="verifactu" element={<Verifactu />} />
                <Route path="importar" element={<ImportExport />} />
                <Route path="buscar" element={<AdvancedSearch />} />
                <Route path="auditoria" element={<Audit />} />
                <Route path="plantillas-email" element={<EmailTemplates />} />
                <Route path="gestor" element={<Gestor />} />
                <Route path="firma" element={<DigitalSignature />} />
                <Route path="importar-ia" element={<AIImport />} />
                <Route path="panel-fiscal" element={<FiscalPanel />} />
                <Route path="asistente" element={<AIAssistant />} />
                <Route path="asesor" element={<Advisor />} />
                <Route path="salud" element={<BusinessHealth />} />
                <Route path="reportes" element={<Reports />} />
                <Route path="calendario" element={<FiscalCalendar />} />
                <Route path="configuracion" element={<SettingsPage />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </ProfileProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
