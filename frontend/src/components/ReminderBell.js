import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Bell, AlertTriangle, Info } from "lucide-react";

export default function ReminderBell() {
  const [items, setItems] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    const load = () => api.get("/reminders").then((r) => setItems(r.data || [])).catch(() => {});
    load();
    const t = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, []);

  const count = items.length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" data-testid="reminder-bell">
          <Bell className="h-4 w-4" />
          {count > 0 && <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">{count}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="px-4 py-3 border-b border-border"><h4 className="font-heading font-semibold text-sm">Recordatorios</h4></div>
        {items.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">Sin avisos por ahora 🎉</div>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            {items.map((r) => {
              const Icon = r.type === "warning" ? AlertTriangle : Info;
              return (
                <button key={r.id} onClick={() => navigate(r.action || "/app")} className="w-full text-left p-3 hover:bg-muted border-b border-border last:border-0 flex items-start gap-3">
                  <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${r.type === "warning" ? "text-amber-600" : "text-primary"}`} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{r.title}</div>
                    <div className="text-xs text-muted-foreground">{r.detail}</div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
