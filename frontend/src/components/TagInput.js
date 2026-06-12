import { useState } from "react";
import { Input } from "@/components/ui/input";
import { X, Tag } from "lucide-react";

export default function TagInput({ value = [], onChange, placeholder = "Añadir etiqueta..." }) {
  const [text, setText] = useState("");

  const add = (t) => {
    const cleaned = t.trim().toLowerCase();
    if (!cleaned) return;
    if (value.includes(cleaned)) return;
    onChange([...value, cleaned]);
    setText("");
  };

  const remove = (t) => onChange(value.filter((v) => v !== t));

  return (
    <div className="flex flex-wrap items-center gap-1.5 p-2 border border-input rounded-md bg-background min-h-[40px]">
      {value.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-primary/10 text-primary">
          <Tag className="h-3 w-3" />{t}
          <button type="button" onClick={() => remove(t)} className="ml-0.5 hover:text-destructive"><X className="h-3 w-3" /></button>
        </span>
      ))}
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(text); }
          if (e.key === "Backspace" && !text && value.length) remove(value[value.length - 1]);
        }}
        onBlur={() => text && add(text)}
        placeholder={placeholder}
        className="flex-1 border-0 shadow-none focus-visible:ring-0 px-1 h-auto py-0.5"
      />
    </div>
  );
}
