import { toast } from "sonner";
import { Download, GitBranch } from "lucide-react";
import { clsx } from "clsx";
import { api } from "../../api/client";
import { useStore } from "../../store/store";

/** The provenance DAG as a horizontal filmstrip of step chips. Transport lives
 *  in the waveform column (shell/Transport.tsx). */
export function ProvenanceStrip() {
  const session = useStore((s) => s.session);
  const history = useStore((s) => s.history);
  const head = useStore((s) => s.ledgerHead);
  const leaves = useStore((s) => s.leaves);
  const selectedStep = useStore((s) => s.selectedStep);
  const setSelectedStep = useStore((s) => s.setSelectedStep);
  const patchSession = useStore((s) => s.patchSession);
  const refreshHistory = useStore((s) => s.refreshHistory);
  const refreshGraph = useStore((s) => s.refreshGraph);
  const loadLayout = useStore((s) => s.loadLayout);
  const id = session?.session_id;

  const checkout = async (seq: number) => {
    if (!id) return;
    try {
      patchSession(await api.revert(id, seq));
      await Promise.all([refreshHistory(), refreshGraph(), loadLayout()]);
      toast.success(seq === 0 ? "Reverted to pristine" : `Checked out step ${seq}`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const forked = leaves.length > 1;

  return (
    <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-t border-seam bg-bg px-2 py-1 text-2xs">
      <span className="mr-1 shrink-0 uppercase tracking-wide text-fg-faint">pipeline</span>
      <button
        onClick={() => checkout(0)}
        className={clsx(
          "shrink-0 rounded-full border px-2 py-0.5",
          head === 0 ? "border-accent text-accent" : "border-seam text-fg-faint hover:text-fg-dim",
        )}
      >
        pristine
      </button>
      {history.map((e) => (
        <div key={e.seq} className="flex shrink-0 items-center gap-1">
          <span className="text-fg-faint">{e.parent !== 0 && e.parent !== e.seq - 1 ? "⋔" : "→"}</span>
          <button
            onClick={() => { setSelectedStep(e.seq); void checkout(e.seq); }}
            title={e.rendered}
            className={clsx(
              "rounded-full border px-2 py-0.5 transition-colors",
              e.seq === head
                ? "border-accent bg-accent/15 font-medium text-accent"
                : e.on_path
                  ? "border-seam text-fg-dim hover:text-fg"
                  : "border-dashed border-seam text-fg-faint hover:text-fg-dim",
              selectedStep === e.seq && "ring-1 ring-accent",
            )}
          >
            {e.label.length > 24 ? e.label.slice(0, 23) + "…" : e.label}
          </button>
        </div>
      ))}
      {forked && (
        <span className="ml-1 flex shrink-0 items-center gap-1 text-fg-faint">
          <GitBranch size={10} /> {leaves.length} branches
        </span>
      )}
      {id && (
        <a
          href={api.exportPipelineUrl(id)}
          target="_blank"
          rel="noreferrer"
          className="ml-auto flex shrink-0 items-center gap-1 rounded-xs border border-seam px-2 py-0.5 text-fg-dim hover:text-fg"
        >
          <Download size={10} /> pipeline.py
        </a>
      )}
    </div>
  );
}
