import type { ReactNode } from "react";
import { clsx } from "clsx";

/** A small status/label chip. `title` prevents clipped text from being lost. */
export function Chip({
  children,
  tone = "default",
  title,
  className,
}: {
  children: ReactNode;
  tone?: "default" | "accent" | "alert" | "good" | "warn" | "ghost";
  title?: string;
  className?: string;
}) {
  const tones: Record<string, string> = {
    default: "border-seam text-fg-dim",
    accent: "border-accent/40 text-accent bg-accent/10",
    alert: "border-alert/40 text-alert bg-alert/10",
    good: "border-good/40 text-good bg-good/10",
    warn: "border-warn/40 text-warn bg-warn/10",
    ghost: "border-dashed border-seam text-fg-faint",
  };
  return (
    <span
      title={title}
      className={clsx(
        "inline-flex max-w-[16ch] items-center gap-1 truncate rounded-full border px-2 py-0.5 text-2xs",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "sm",
}: {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  size?: "xs" | "sm";
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-xs border border-seam text-2xs">
      {options.map((o, i) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            i > 0 && "border-l border-seam",
            size === "xs" ? "px-1.5 py-0.5" : "px-2 py-1",
            "transition-colors",
            value === o.value
              ? "bg-accent/15 font-medium text-accent"
              : "text-fg-faint hover:text-fg-dim",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Section label inside the inspector / rail. */
export function GroupLabel({ children }: { children: ReactNode }) {
  return <div className="px-0.5 text-2xs uppercase tracking-wide text-fg-faint">{children}</div>;
}

/** A key/value row that never lets the value push the key off-screen. */
export function KV({ k, v, tone }: { k: string; v: ReactNode; tone?: "alert" | "good" | "accent" }) {
  const c = tone === "alert" ? "text-alert" : tone === "good" ? "text-good" : tone === "accent" ? "text-accent" : "text-fg-dim";
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5 text-xs">
      <span className="shrink-0 text-fg-faint">{k}</span>
      <span className={clsx("mono truncate text-right", c)}>{v}</span>
    </div>
  );
}
