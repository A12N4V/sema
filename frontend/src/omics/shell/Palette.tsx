import { useEffect, useMemo, useRef, useState } from "react";
import { clsx } from "clsx";
import { useStore, usePage } from "../store";

/**
 * The keyboard spine: ⌘K or / opens the palette; `[` and `]` step through the
 * active noun's figures; `g` focuses the gene search; `?` lists the keys.
 * Every handler gates on document.activeElement so typing in an input never
 * triggers a shortcut.
 */
type Item = { label: string; hint?: string; run: () => void; group: string };

export function Palette() {
  const palette = useStore((s) => s.palette);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const catalogue = useStore((s) => s.catalogue);
  const wfId = useStore((s) => s.wfId);
  const page = usePage();
  const gene = useStore((s) => s.gene);
  const setGene = useStore((s) => s.setGene);

  useEffect(() => {
    if (palette) { setQ(""); setSel(0); setTimeout(() => input.current?.focus(), 0); }
  }, [palette]);

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    const go = (p: string) => useStore.getState().setPage(p);
    out.push({ label: "Pipeline", group: "Nouns", run: () => go("pipeline") });
    for (const n of catalogue) out.push({ label: n.label, hint: n.hint, group: "Nouns", run: () => go(n.id) });
    out.push({ label: "Ledger", group: "Nouns", run: () => go("ledger") });
    for (const n of catalogue) for (const f of n.figures)
      out.push({ label: f.title, hint: `${n.label} · ${f.kind}`, group: "Figures", run: () => { go(n.id); useStore.getState().setFocus(n.id, `fig:${f.id}`); } });
    // genes: the top symbols of the de figures already in the catalogue's specs
    for (const n of catalogue) if (n.id === "genes" || n.id === "de")
      out.push({ label: `Gene ${gene ?? ""}`.trim(), hint: "clear the selected gene", group: "Selection", run: () => setGene(null) });
    for (const s of useStore.getState().geneSets)
      out.push({ label: `Set ${s.name}`, hint: `${s.genes.length} genes · ${s.origin}`, group: "Selection", run: () => useStore.getState().set({ gene: s.genes[0] ?? null }) });
    out.push({ label: "Pipeline & ledger are one keystroke away", hint: "⌘K jump · [ ] step figures · g gene search · ? keys", group: "Actions", run: () => useStore.getState().setPalette({ mode: "keys" }) });
    return out;
  }, [catalogue, wfId, page, gene, setGene]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (t ? items.filter((i) => `${i.label} ${i.hint ?? ""}`.toLowerCase().includes(t)) : items).slice(0, 40);
  }, [q, items]);

  useEffect(() => {
    if (!palette) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { useStore.getState().setPalette(null); return; }
      if (palette.mode === "keys") return;
      if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, shown.length - 1)); }
      if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
      if (e.key === "Enter") { shown[sel]?.run(); useStore.getState().setPalette(null); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [palette, shown, sel]);

  if (!palette) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[12vh]" onClick={() => useStore.getState().setPalette(null)}>
      <div className={clsx("pop w-[min(560px,92vw)] p-0")} role="dialog" aria-label="Command palette" onClick={(e) => e.stopPropagation()}>
        {palette.mode === "keys" ? (
          <div className="p-4 text-xs leading-6 text-fg-dim">
            <div className="mb-2 text-2xs uppercase tracking-[0.12em] text-fg-faint">Keys</div>
            {[
              ["⌘K or /", "command palette: jump to any figure, gene, noun or action"],
              ["[ and ]", "step through this noun's figures"],
              ["g", "focus the gene search (type a symbol, Enter selects it)"],
              ["?", "this list"],
              ["Esc", "close"],
            ].map(([k, d]) => <div key={k}><kbd className="mono rounded-xs border border-seam px-1 text-2xs">{k}</kbd> {d}</div>)}
          </div>
        ) : (
          <>
            <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setSel(0); }} placeholder="Jump to figure, noun, gene set…"
                   aria-label="Command palette search"
                   className="h-10 w-full bg-transparent px-4 text-sm text-fg outline-none placeholder:text-fg-faint" />
            <div className="max-h-72 overflow-y-auto border-t border-seam">
              {shown.map((it, i) => (
                <button key={`${it.group}:${it.label}:${i}`} onClick={() => { it.run(); useStore.getState().setPalette(null); }}
                        className={clsx("flex w-full items-baseline gap-2 px-4 py-1.5 text-left text-xs", i === sel ? "bg-panel-2 text-fg" : "text-fg-dim hover:bg-panel-2/60")}>
                  <span className="min-w-0 flex-1 truncate">{it.label}</span>
                  {it.hint && <span className="mono shrink-0 truncate text-2xs text-fg-faint">{it.hint}</span>}
                  <span className="mono shrink-0 text-2xs text-fg-faint/60">{it.group}</span>
                </button>
              ))}
              {!shown.length && <div className="px-4 py-3 text-xs text-fg-faint">Nothing matches.</div>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Global shortcuts: palette, figure stepping, gene focus, help. */
export function useShortcuts() {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const el = document.activeElement;
      const typing = el instanceof HTMLElement && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
      if (typing || e.metaKey || e.ctrlKey || e.altKey) {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); useStore.getState().setPalette({ mode: "command" }); }
        return;
      }
      if (e.metaKey || e.ctrlKey) return;
      const st = useStore.getState();
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); st.setPalette({ mode: "command" }); return; }
      switch (e.key) {
        case "/": case "K":
          e.preventDefault(); st.setPalette({ mode: "command" }); break;
        case "[": case "]": {
          const noun = st.catalogue.find((n) => n.id === (st.page[st.wfId] ?? "pipeline"));
          if (!noun?.figures.length) return;
          const cur = st.focus[`${st.wfId}:${noun.id}`] ?? "";
          const idx = noun.figures.findIndex((f) => `fig:${f.id}` === cur);
          const next = e.key === "]" ? (idx + 1 + noun.figures.length) % noun.figures.length : (idx - 1 + noun.figures.length) % noun.figures.length;
          st.setFocus(noun.id, `fig:${noun.figures[next].id}`);
          break;
        }
        case "g": {
          const inp = document.querySelector<HTMLInputElement>("input[aria-label='Search genes']");
          if (inp) { inp.focus(); inp.select(); }
          break;
        }
        case "?": st.setPalette({ mode: "keys" }); break;
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
}
