import type { ReactNode } from "react";
import { clsx } from "clsx";
import { Loader2 } from "lucide-react";

export function Btn({ children, onClick, disabled, tone, title, busy, active, className, ...rest }: {
  children: ReactNode; onClick?: () => void; disabled?: boolean; tone?: "accent" | "alert"; title?: string;
  busy?: boolean; active?: boolean; className?: string; "aria-label"?: string;
}) {
  return (
    <button
      onClick={onClick} disabled={disabled || busy} title={title} aria-label={rest["aria-label"]} aria-pressed={active}
      className={clsx("flex h-6 shrink-0 items-center gap-1.5 rounded-sm border px-2 text-xs transition-colors disabled:opacity-40",
        tone === "accent" ? "border-accent bg-accent text-white hover:brightness-110"
          : tone === "alert" ? "border-alert/60 text-alert hover:bg-alert/10"
            : active ? "border-accent/70 bg-accent/10 text-fg"
              : "border-seam text-fg-dim hover:border-seam-bright hover:text-fg", className)}
    >
      {busy && <Loader2 size={12} className="animate-spin" />}
      {children}
    </button>
  );
}

export function IconBtn({ children, onClick, label, active, disabled }: { children: ReactNode; onClick?: () => void; label: string; active?: boolean; disabled?: boolean }) {
  return (
    <button onClick={onClick} aria-label={label} title={label} aria-pressed={active} disabled={disabled}
            className={clsx("flex h-6 w-6 shrink-0 items-center justify-center rounded-sm transition-colors disabled:opacity-30",
              active ? "bg-accent/15 text-accent" : "text-fg-faint hover:bg-panel-2 hover:text-fg")}>
      {children}
    </button>
  );
}

/** A labelled ribbon group: controls on top, its name underneath, like Office and Sema. */
export function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex shrink-0 flex-col justify-between gap-1 border-r border-seam px-2.5 last:border-r-0">
      <div className="flex items-center gap-1.5">{children}</div>
      <span className="text-center text-2xs text-fg-faint">{label}</span>
    </div>
  );
}

export function Seg<T extends string>({ value, options, onChange, label }: {
  value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div className="flex shrink-0 overflow-hidden rounded-sm border border-seam text-xs" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
                className={clsx("h-6 px-2 transition-colors", value === o.value ? "bg-panel-2 text-fg" : "text-fg-faint hover:text-fg-dim")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function PaneHead({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex h-8 shrink-0 items-center gap-2 border-b border-seam px-3">
      <span className="shrink-0 text-2xs font-semibold uppercase tracking-[0.12em] text-fg-dim">{title}</span>
      {sub && <span className="mono min-w-0 truncate text-2xs text-fg-faint">{sub}</span>}
      <span className="flex-1" />
      {children}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="flex h-full items-center justify-center px-6 text-center text-sm text-fg-faint">{children}</div>;
}
