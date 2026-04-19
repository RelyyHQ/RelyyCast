export function ConfigField({
  label,
  value,
  onChange,
  disabled = false,
}: Readonly<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}>) {
  return (
    <label className={["grid gap-0.5 rounded-sm border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] px-1.5 py-1", disabled ? "opacity-50" : ""].join(" ")}>
      <span className="text-[8px] font-bold uppercase tracking-[0.12em] text-[hsl(var(--theme-muted))]">{label}</span>
      <input
        type="text"
        value={value}
        disabled={disabled}
        onChange={(event) => { onChange(event.target.value); }}
        className="h-6 rounded-sm border border-[hsl(var(--theme-border))] bg-white px-1.5 text-[10px] leading-4 outline-none focus:border-[hsl(var(--theme-primary))] disabled:cursor-not-allowed dark:bg-[hsl(var(--theme-surface))]"
      />
    </label>
  );
}