import { useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import { RotateCcw } from "lucide-react";
import type { Param, Value } from "../api";
import { NO_EDITS, useStore, useWorkflow } from "../store";
import { PaneHead } from "../ui/primitives";

export function Params() {
  const wf = useWorkflow()!;
  const edits = useStore((s) => s.edits[s.wfId]) ?? NO_EDITS;
  const engine = useStore((s) => s.engine[s.wfId] ?? wf.engines[0]);
  const groups = useMemo(() => {
    const g = new Map<string, Param[]>();
    for (const p of wf.params) g.set(p.group || "Other", [...(g.get(p.group || "Other") ?? []), p]);
    return [...g.entries()];
  }, [wf]);
  return (
    <aside className="flex h-full min-h-0 flex-col bg-bg">
      <PaneHead title="Parameters" sub={engine === "R" ? "config.R" : engine === "python" ? "config.py" : "configuration cell"} />
      <div className="min-h-0 flex-1 overflow-y-auto pb-3">
        {groups.map(([g, ps]) => (
          <section key={g} className="border-b border-seam px-3 py-2">
            <h3 className="mb-1.5 text-2xs uppercase tracking-[0.12em] text-fg-faint">{g}</h3>
            <div className="flex flex-col gap-1.5">
              {ps.map((p) => <ParamRow key={p.name} p={p} value={edits[p.name]} />)}
            </div>
          </section>
        ))}
      </div>
    </aside>
  );
}

export function ParamRow({ p, value, compact }: { p: Param; value: Value | undefined; compact?: boolean }) {
  const set = (v: Value | undefined) => useStore.getState().setParam(p.name, v);
  const v = value ?? p.default;
  const edited = value !== undefined;
  const show = (x: Value) => (Array.isArray(x) ? x.join(", ") : String(x));
  const [draft, setDraft] = useState(show(v));
  useEffect(() => { setDraft(show(v)); }, [value, p]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = () => {
    if (p.type === "list") {
      const num = Array.isArray(p.default) && typeof p.default[0] === "number";
      const items = draft.split(",").map((s) => s.trim()).filter(Boolean);
      set(num ? items.map(Number) : items);
    } else if (p.type === "int" || p.type === "float") {
      const n = Number(draft);
      if (Number.isFinite(n) && (p.type === "float" || Number.isInteger(n))) set(n); else setDraft(show(v));
    } else set(draft);
  };
  const id = `p-${p.name}${compact ? "-r" : ""}`;
  return (
    <div className="group" title={p.help}>
      <div className="flex items-center gap-2">
        <label htmlFor={id} className={clsx("mono min-w-0 flex-1 truncate text-2xs", edited ? "text-accent" : compact ? "text-fg-faint" : "text-fg-dim")}>{p.name}</label>
        {p.type === "bool" ? (
          <button id={id} role="switch" aria-checked={!!v} onClick={() => set(!v)}
                  className={clsx("relative h-4 w-7 shrink-0 rounded-full border transition-colors", v ? "border-accent bg-accent" : "border-seam-bright bg-panel-2")}>
            <span className={clsx("absolute top-[1px] h-3 w-3 rounded-full bg-white transition-all", v ? "left-[13px]" : "left-[1px]")} />
          </button>
        ) : (
          <input id={id} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit}
                 onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                 inputMode={p.type === "int" || p.type === "float" ? "decimal" : undefined}
                 className={clsx("mono h-6 shrink-0 rounded-sm border bg-panel px-1.5 text-2xs outline-none", compact ? "w-16" : "w-32",
                   edited ? "border-accent/60 text-fg" : "border-seam text-fg-dim focus:border-seam-bright")} />
        )}
        {!compact && (
          <button onClick={() => set(undefined)} aria-label={`Reset ${p.name}`}
                  className={clsx("shrink-0 text-fg-faint hover:text-fg", edited ? "visible" : "invisible")}><RotateCcw size={10} /></button>
        )}
      </div>
      {p.help && !compact && <p className="mt-0.5 hidden text-2xs leading-snug text-fg-faint group-focus-within:block">{p.help}</p>}
    </div>
  );
}
