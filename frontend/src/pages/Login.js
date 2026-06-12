import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/Logo";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    const res = await login(email, password);
    setLoading(false);
    if (res.ok) {
      toast.success("Sesión iniciada");
      navigate("/app");
    } else {
      toast.error(res.error);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="hidden lg:flex flex-col justify-between bg-secondary text-secondary-foreground p-12 relative overflow-hidden">
        <div className="absolute inset-0 grid-pattern opacity-10" />
        <Logo />
        <div className="relative">
          <h2 className="font-heading text-4xl font-bold leading-tight max-w-md">
            La facturación inteligente que tu negocio se merece.
          </h2>
          <p className="mt-4 text-secondary-foreground/70 max-w-md">
            Olvídate de hojas de cálculo y plantillas. FakturaFlow automatiza tu día a día fiscal.
          </p>
        </div>
        <p className="text-xs text-secondary-foreground/50">© 2026 FakturaFlow</p>
      </div>
      <div className="flex items-center justify-center p-6 md:p-12">
        <form onSubmit={submit} className="w-full max-w-sm space-y-6" data-testid="login-form">
          <div className="lg:hidden mb-4"><Logo /></div>
          <div>
            <h1 className="font-heading text-3xl font-bold">Bienvenido de nuevo</h1>
            <p className="text-sm text-muted-foreground mt-1">Accede a tu cuenta para continuar</p>
          </div>
          <div className="space-y-3">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1.5" data-testid="login-email" />
            </div>
            <div>
              <Label htmlFor="password">Contraseña</Label>
              <Input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1.5" data-testid="login-password" />
            </div>
          </div>
          <Button type="submit" className="w-full" disabled={loading} data-testid="login-submit">
            {loading ? "Entrando..." : "Iniciar sesión"}
          </Button>
          <p className="text-sm text-center text-muted-foreground">
            ¿No tienes cuenta? <Link to="/registro" className="text-primary hover:underline font-medium">Regístrate gratis</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
