export function UrlRow({
  label,
  value,
  canCopy = true,
  onCopy,
}: Readonly<{ label: string; value: string; canCopy?: boolean; onCopy: () => void }>) {
  return (
    <div className="grid grid-cols-[32px_minmax(0,1fr)_48px] items-center gap-1 rounded-sm border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] px-1.5 py-1">
      <span className="text-[8px] font-bold uppercase tracking-[0.12em] text-[hsl(var(--theme-muted))]">{label}</span>
      <span className="truncate font-mono text-[9px]" title={value}>{value}</span>
      <button
        type="button"
        onClick={onCopy}
        disabled={!canCopy}
        className="h-5 rounded-sm border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface))] text-[8px] font-semibold disabled:cursor-not-allowed disabled:opacity-50"
      >
        Copy
      </button>
    </div>
  );
}
