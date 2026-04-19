export function ActionButton({
  children,
  disabled = false,
  onClick,
}: Readonly<{
  children: React.ReactNode;
  disabled?: boolean;
  onClick?: () => void;
}>) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-7 items-center justify-center rounded-sm border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] px-1.5 text-[9px] font-semibold disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}