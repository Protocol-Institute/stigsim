export function ParamCard({
  label, description, value, displayValue, min, max, step, onChange, onPointerUp, disabled,
}: {
  label: string;
  description: string;
  value: number;
  displayValue: string;
  min: number; max: number; step: number;
  onChange: (v: number) => void;
  onPointerUp?: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div style={{
      background: "#0f0a04",
      border: "1px solid #3d2e18",
      borderRadius: 10,
      padding: "14px 16px",
      display: "flex",
      flexDirection: "column",
      gap: 8,
      flex: "1 1 270px",
      minWidth: 0,
      opacity: disabled ? 0.4 : 1,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "#e5d5b5" }}>{label}</span>
        <span style={{ fontSize: "0.85rem", fontWeight: 700, color: "#f59e0b", whiteSpace: "nowrap" }}>{displayValue}</span>
      </div>
      <p style={{ margin: 0, fontSize: "0.72rem", color: "#a08060", lineHeight: 1.45 }}>{description}</p>
      <input
        type="range"
        min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        onPointerUp={onPointerUp ? e => onPointerUp(Number((e.target as HTMLInputElement).value)) : undefined}
        disabled={disabled}
        style={{ width: "100%", accentColor: "#f59e0b", cursor: disabled ? "not-allowed" : "pointer", margin: "2px 0" }}
      />
    </div>
  );
}
