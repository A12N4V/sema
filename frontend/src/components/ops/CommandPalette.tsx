import { useEffect, useMemo, useRef, useState } from "react";
import { X, ChevronLeft, Lock } from "lucide-react";
import { api, type OpSchema } from "../../api/client";
import { runOp } from "../../lib/ops";
import { useCapabilities } from "../../lib/useCapabilities";
import { useStore } from "../../store/store";
import { ParamForm, type JsonSchema } from "./ParamForm";

/** Mounted only while open (see PaletteMount), so state starts fresh each time. */
export function CommandPalette({ onClose }: { onClose: () => void }) {
  const caps = useCapabilities();
  const [ops, setOps] = useState<OpSchema[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<OpSchema | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const paletteOpId = useStore((s) => s.paletteOpId);

  // Every operation is listed always: the capability lock below (not a
  // container filter) is what says whether it's reachable right now, and
  // why. A toolbar shortcut can also land straight in one op's form.
  useEffect(() => {
    api.listOps().then((r) => {
      setOps(r.operations);
      if (paletteOpId) {
        const op = r.operations.find((o) => o.id === paletteOpId);
        if (op) setSelected(op);
      }
    }).catch(() => setOps([]));
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (selected) setSelected(null);
      else onClose();
    };
    window.addEventListener("keydown", onEsc, true);
    return () => window.removeEventListener("keydown", onEsc, true);
  }, [selected, onClose]);

  const missing = (op: OpSchema) => op.requires.filter((r) => !caps.has(r));

  const groups = useMemo(() => {
    const q = query.toLowerCase().trim();
    const match = ops.filter(
      (o) => !q || o.label.toLowerCase().includes(q) || o.id.includes(q) || o.doc.toLowerCase().includes(q),
    );
    const by = new Map<string, OpSchema[]>();
    for (const o of match) by.set(o.stage, [...(by.get(o.stage) ?? []), o]);
    return [...by.entries()];
  }, [ops, query]);

  const run = async (params: Record<string, unknown>) => {
    if (!selected) return;
    setBusy(true);
    try {
      await runOp(selected.id, params, `${selected.label}, done`);
      onClose();
    } catch {
      /* toast already fired */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[10vh] backdrop-blur-[1px] max-[480px]:pt-4"
      onMouseDown={onClose}
    >
      <div className="pop flex max-h-[80vh] w-[560px] max-w-[92vw] flex-col overflow-hidden" onMouseDown={(e) => e.stopPropagation()}>
        <header className="flex items-center gap-2 border-b border-seam px-3 py-2">
          {selected ? (
            <button onClick={() => setSelected(null)} className="rounded-xs p-0.5 text-fg-faint hover:text-fg">
              <ChevronLeft size={15} />
            </button>
          ) : null}
          {selected ? (
            <span className="flex-1 text-sm font-semibold text-fg">{selected.label}</span>
          ) : (
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Run an operation…"
              className="flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-faint"
            />
          )}
          <button onClick={onClose} className="rounded-xs p-0.5 text-fg-faint hover:bg-panel-2 hover:text-fg">
            <X size={15} />
          </button>
        </header>

        {selected ? (
          <div className="overflow-y-auto p-4">
            {selected.doc && <p className="mb-3 text-xs text-fg-dim">{selected.doc}</p>}
            <ParamForm
              schema={selected.params_schema as JsonSchema}
              submitLabel={`Run ${selected.label}`}
              busy={busy}
              onSubmit={run}
            />
          </div>
        ) : (
          <div className="overflow-y-auto py-1">
            {groups.length === 0 && <p className="px-4 py-6 text-center text-xs text-fg-faint">No matching operations.</p>}
            {groups.map(([stage, list]) => (
              <div key={stage} className="mb-1">
                <div className="px-3 pb-0.5 pt-2 text-2xs uppercase tracking-wide text-fg-faint">{stage}</div>
                {list.map((op) => {
                  const need = missing(op);
                  return (
                    <button
                      key={op.id}
                      disabled={need.length > 0}
                      onClick={() => setSelected(op)}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-fg-dim transition-colors hover:bg-panel-2 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                    >
                      <span className="flex-1 truncate">{op.label}</span>
                      {op.long_running && <span className="mono text-2xs text-fg-faint">job</span>}
                      {need.length > 0 && (
                        <span className="flex items-center gap-1 text-2xs text-alert">
                          <Lock size={9} /> {need.join(", ")}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
