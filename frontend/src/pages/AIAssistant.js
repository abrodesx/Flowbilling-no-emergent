import { useEffect, useRef, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sparkles, Send, User, Bot } from "lucide-react";
import { toast } from "sonner";

const SUGGESTIONS = [
  "¿Cuánto he ganado este trimestre?",
  "¿Qué cliente me genera más ingresos?",
  "¿Cuánto IVA voy a pagar este trimestre?",
  "Muéstrame mis gastos por categoría",
  "¿Tengo facturas pendientes?",
  "¿Cómo va mi beneficio anual?",
];

export default function AIAssistant() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const send = async (text) => {
    const msg = (text ?? input).trim();
    if (!msg || loading) return;
    setMessages((m) => [...m, { role: "user", content: msg }]);
    setInput("");
    setLoading(true);
    try {
      const { data } = await api.post("/ai/chat", { message: msg, session_id: sessionId });
      if (!sessionId) setSessionId(data.session_id);
      setMessages((m) => [...m, { role: "assistant", content: data.answer }]);
    } catch (e) {
      toast.error(formatApiError(e));
      setMessages((m) => [...m, { role: "assistant", content: "Lo siento, no pude procesar eso. Intenta de nuevo." }]);
    } finally { setLoading(false); }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto" data-testid="ai-assistant">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-md bg-primary/10 text-primary flex items-center justify-center"><Sparkles className="h-5 w-5" /></div>
        <div>
          <h1 className="font-heading text-3xl font-bold">Asistente IA</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Pregunta lo que quieras sobre tu actividad fiscal y financiera</p>
        </div>
      </div>

      <Card className="flex flex-col h-[560px]">
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center">
              <div className="h-12 w-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-3">
                <Sparkles className="h-6 w-6" />
              </div>
              <p className="font-semibold mb-1">¡Hola! Soy tu asistente FakturaFlow.</p>
              <p className="text-sm text-muted-foreground max-w-md mb-6">Tengo acceso a tus datos en tiempo real (facturas, gastos, clientes). Pregúntame lo que necesites saber sobre tu negocio.</p>
              <div className="flex flex-wrap justify-center gap-2 max-w-2xl">
                {SUGGESTIONS.map((s) => (
                  <Button key={s} size="sm" variant="outline" onClick={() => send(s)} data-testid={`suggestion-${s.slice(0,15)}`}>{s}</Button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`flex gap-3 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
              <div className={`h-8 w-8 shrink-0 rounded-full flex items-center justify-center ${m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                {m.role === "user" ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
              </div>
              <div className={`rounded-lg p-3 max-w-[80%] text-sm whitespace-pre-wrap ${m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                {m.content}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex gap-3">
              <div className="h-8 w-8 shrink-0 rounded-full bg-muted flex items-center justify-center"><Bot className="h-4 w-4" /></div>
              <div className="rounded-lg p-3 bg-muted text-sm flex gap-1">
                <span className="h-2 w-2 rounded-full bg-muted-foreground/60 animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="h-2 w-2 rounded-full bg-muted-foreground/60 animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="h-2 w-2 rounded-full bg-muted-foreground/60 animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); send(); }}
          className="border-t border-border p-3 flex gap-2"
        >
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Escribe tu pregunta..."
            disabled={loading}
            data-testid="ai-input"
          />
          <Button type="submit" disabled={loading || !input.trim()} data-testid="ai-send"><Send className="h-4 w-4" /></Button>
        </form>
      </Card>
    </div>
  );
}
