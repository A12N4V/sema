import { useEffect, useState } from "react";
import { useStore } from "../store";
import { api, type Spec } from "../api";

/**
 * The gene search: `g` focuses it, typing narrows over every gene the run's
 * figures mention, Enter selects. The selected gene is the spine – every view
 * that renders a gene reads store.gene.
 */
export function GeneSearch() {
  const runId = useStore((s) => s.runId);
  const wfId = useStore((s) => s.wfId);
  const gene = useStore((s) => s.gene);
  const [text, setText] = useState("");
  const [all, setAll] = useState<string[]>([]);
  useEffect(() => { setText(gene ?? ""); }, [gene]);
  useEffect(() => {
    if (!runId) return;
    api.figure(runId, wfId === "bulk" ? "genes" : "de", "de").then((s: Spec) => setAll(s.genes ?? [])).catch(() => {});
  }, [runId, wfId]);
  const pick = () => useStore.getState().setGene(text.trim() || null);
  return (
    <span className="relative my-1.5 hidden items-center sm:flex">
      <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && pick()}
             placeholder="gene…" aria-label="Search genes" list="gene-search-list"
             className="mono h-6 w-32 rounded-sm border border-seam bg-bg px-1.5 text-2xs text-fg placeholder:text-fg-faint" />
      <datalist id="gene-search-list">{all.slice(0, 400).map((g) => <option key={g} value={g} />)}</datalist>
    </span>
  );
}
