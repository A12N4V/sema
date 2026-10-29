import { useEffect, useState } from "react";
import { clsx } from "clsx";
import type { Spec, Value } from "../api";
import { useStore } from "../store";
import { CONTROLS, defaults } from "./settings";

/** The controls for one figure, laid out as a row (ribbon) or a column (popover). */
export function FigureSettings({ spec, skey, layout = "row" }: { spec: Spec; skey: string; layout?: "row" | "col" }) {
  const saved = useStore((s) => s.settings[skey]);
  const setSetting = useStore((s) => s.setSetting);
  const vals = { ...defaults(spec), ...(saved ?? {}) };
  const controls = CONTROLS[spec.kind] ?? [];
  if (!controls.length) return null;
  return (
    <div className={clsx("flex gap-2", layout === "row" ? "items-center" : "flex-col")}>
      {controls.map((c) => {
        const v = vals[c.key];
        const wrap = (el: React.ReactNode) => (
          <label key={c.key} className={clsx("flex items-center gap-1.5 text-2xs text-fg-faint", layout === "col" && "justify-between")}>
            <span className="shrink-0">{c.label}</span>{el}
          </label>
        );
        if (c.type === "toggle") return wrap(
          <button role="switch" aria-checked={!!v} onClick={() => setSetting(skey, c.key, !v)} aria-label={c.label}
                  className={clsx("relative h-4 w-7 shrink-0 rounded-full border transition-colors", v ? "border-accent bg-accent" : "border-seam-bright bg-panel-2")}>
            <span className={clsx("absolute top-[1px] h-3 w-3 rounded-full bg-white transition-all", v ? "left-[13px]" : "left-[1px]")} />
          </button>);
        if (c.type === "select") {
          const opts = c.options(spec);
          return wrap(
            <select value={String(v ?? "")} onChange={(e) => setSetting(skey, c.key, e.target.value)} aria-label={c.label}
                    className="mono h-6 max-w-36 rounded-sm border border-seam bg-bg px-1 text-2xs text-fg-dim">
              {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>);
        }
        return wrap(<NumberBox value={v as number} step={c.step} min={c.min} max={c.max} label={c.label}
                               onCommit={(n) => setSetting(skey, c.key, n)} />);
      })}
    </div>
  );
}

function NumberBox({ value, step, min, max, onCommit, label }: { value: number; step: number; min?: number; max?: number; label: string; onCommit: (n: Value) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    let n = Number(draft);
    if (!Number.isFinite(n)) { setDraft(String(value)); return; }
    if (min != null) n = Math.max(min, n); if (max != null) n = Math.min(max, n);
    onCommit(n); setDraft(String(n));
  };
  return (
    <input value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} aria-label={label}
           onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur();
             if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); const n = +(Number(draft) + (e.key === "ArrowUp" ? step : -step)).toPrecision(6); setDraft(String(n)); onCommit(n); } }}
           inputMode="decimal" className="mono h-6 w-14 rounded-sm border border-seam bg-bg px-1.5 text-2xs text-fg outline-none focus:border-accent/60" />
  );
}
