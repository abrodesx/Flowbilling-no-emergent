export const Logo = ({ size = 32, withText = true }) => (
  <div className="flex items-center gap-2.5" data-testid="brand-logo">
    <div
      style={{ width: size, height: size }}
      className="rounded-[8px] bg-gradient-to-br from-[#0a1f5c] to-[#1e40af] flex items-center justify-center shadow-sm"
    >
      <span className="font-heading font-bold text-white" style={{ fontSize: size * 0.55 }}>A</span>
    </div>
    {withText && (
      <span className="font-heading font-bold text-lg tracking-tight">
        Faktura<span className="text-primary">Flow</span>
      </span>
    )}
  </div>
);
