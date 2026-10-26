import { clsx } from "clsx";
import { CircleDot, Database, Dna, FileText, Fingerprint, History, Lock, Network, PieChart, ScatterChart, Shapes, Tags, Workflow as WorkflowIcon } from "lucide-react";
import { usePage, useStore } from "../store";
import { useMedia } from "../lib/useMedia";

const ICONS: Record<string, typeof Dna> = { Database, ScatterChart, Dna, Fingerprint, Network, FileText, CircleDot, Shapes, Tags, PieChart };

/**
 * The question each noun answers (docs/design/core.md). The tab itself is the
 * noun, one word, as in Sema's strip ("Raw", "ICA", "Epochs"); the question is
 * its tooltip, so the strip fits without scrolling and still says why.
 */
const QUESTIONS: Record<string, string> = {
  samples: "Are my samples good?",
  genes: "Which genes change, how sure?",
  signatures: "Is the tissue what I think?",
  pathways: "What biology do they add up to?",
  report: "Does the answer survive?",
  nuclei: "Are the nuclei good?",
  clusters: "Which cell types?",
  celltypes: "Identity and contamination?",
  composition: "In what proportions?",
  de: "Genes changing within type",
};

/**
 * The noun axis, along the bottom like a spreadsheet's sheet tabs. Generated
 * from what the run has written, so a result that exists is one click away,
 * and one that does not is shown locked with the stage that makes it, rather
 * than hidden: you can see the whole shape of the method from the start.
 */
export function NounStrip() {
  const catalogue = useStore((s) => s.catalogue);
  const run = useStore((s) => s.run);
  const page = usePage();
  const done = run ? Object.values(run.stages).filter((s) => s === "done").length : 0;
  const total = run ? Object.keys(run.stages).length : 0;
  const go = (p: string) => useStore.getState().setPage(p);
  const narrow = useMedia("(max-width: 899px)");
  const chip = (id: string, label: string, Icon: typeof Dna, live: boolean, hint?: string) => (
    <button key={id} onClick={() => live && go(id)} aria-current={page === id ? "page" : undefined} disabled={!live}
            aria-label={label}
            title={live ? `${label}: ${QUESTIONS[id] ?? hint ?? ""}` : `${label}: ${hint}`}
            className={clsx("flex shrink-0 items-center gap-1.5 rounded-t-sm px-2.5 text-xs transition-colors",
              // phone: an icon tab bar, every tab the same width, the question in the tooltip and label
              "max-[899px]:min-w-10 max-[899px]:flex-1 max-[899px]:justify-center max-[899px]:px-0",
              page === id ? "bg-panel font-medium text-fg shadow-[inset_0_1px_0_var(--color-accent)]" : live ? "text-fg-dim hover:bg-panel-2/60 hover:text-fg" : "cursor-default text-fg-faint/60")}>
      {live ? <Icon size={narrow ? 17 : 12} /> : <Lock size={narrow ? 15 : 11} />}
      {!narrow && label}
    </button>
  );
  return (
    <nav aria-label="Results" className="relative flex h-8 shrink-0 max-[899px]:h-12 items-stretch border-t border-seam bg-bg">
      {run?.active && (
        <div className="absolute -top-px left-0 h-px bg-accent transition-[width] duration-300" style={{ width: `${Math.round((done / Math.max(1, total)) * 100)}%` }}
             role="progressbar" aria-valuenow={done} aria-valuemax={total} aria-label="Stages done" />
      )}
      <div className="no-scrollbar flex min-w-0 flex-1 items-stretch gap-0.5 overflow-x-auto px-1.5 max-[899px]:gap-0 max-[899px]:px-0.5">
        {catalogue.map((n) => chip(n.id, n.label, ICONS[n.icon] ?? FileText,
          n.figures.length + n.static.length + n.tables.length > 0, n.hint))}
        {/* the method and its record sit apart, on the right, as Sema's Pipeline does */}
        <span className="flex-1 max-[899px]:hidden" />
        {chip("pipeline", "Pipeline", WorkflowIcon, true)}
        {chip("ledger", "Ledger", History, !!run?.ledger.length)}
      </div>
      {run && (
        <span className="mono hidden shrink-0 items-center gap-2 border-l border-seam px-3 text-2xs text-fg-faint sm:flex">
          {run.source === "demo" && <span className="rounded-xs bg-warn/15 px-1 text-warn">synthetic</span>}
          {done}/{total} · {run.status}
        </span>
      )}
    </nav>
  );
}
