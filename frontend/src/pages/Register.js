import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/Logo";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", company: "", email: "", password: "" });
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (form.password.length < 6) return toast.error("La contraseña debe tener al menos 6 caracteres");
    setLoading(true);
    const res = await register(form);
    setLoading(false);
    if (res.ok) { toast.success("Cuenta creada"); navigate("/app"); }
    else toast.error(res.error);
  };

  const upd = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="hidden lg:flex flex-col justify-between bg-secondary text-secondary-foreground p-12 relative overflow-hidden">
        <div className="absolute inset-0 grid-pattern opacity-10" />
        <Logo />
        <div className="relative">
          <h2 className="font-heading text-4xl font-bold leading-tight max-w-md">
            Empieza gratis. Sin tarjeta. Sin compromisos.
          </h2>
          <p className="mt-4 text-secondary-foreground/70">3 minutos para configurarlo todo.</p>
        </div>
        <p className="text-xs text-secondary-foreground/50">© 2026 FakturaFlow</p>
      </div>
      <div className="flex items-center justify-center p-6 md:p-12">
        <form onSubmit={submit} className="w-full max-w-sm space-y-6" data-testid="register-form">
          <div className="lg:hidden mb-4"><Logo /></div>
          <div>
            <h1 className="font-heading text-3xl font-bold">Crea tu cuenta</h1>
            <p className="text-sm text-muted-foreground mt-1">Empieza a facturar en menos de 3 minutos</p>
          </div>
          <div className="space-y-3">
            <div><Label>Nombre</Label><Input required value={form.name} onChange={upd("name")} className="mt-1.5" data-testid="register-name" /></div>
            <div><Label>Empresa (opcional)</Label><Input value={form.company} onChange={upd("company")} className="mt-1.5" data-testid="register-company" /></div>
            <div><Label>Email</Label><Input type="email" required value={form.email} onChange={upd("email")} className="mt-1.5" data-testid="register-email" /></div>
            <div><Label>Contraseña</Label><Input type="password" required value={form.password} onChange={upd("password")} className="mt-1.5" data-testid="register-password" /></div>
          </div>
          <Button type="submit" className="w-full" disabled={loading} data-testid="register-submit">
            {loading ? "Creando..." : "Crear cuenta"}
          </Button>
          <p className="text-sm text-center text-muted-foreground">
            ¿Ya tienes cuenta? <Link to="/login" className="text-primary hover:underline font-medium">Inicia sesión</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
