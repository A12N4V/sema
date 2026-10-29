import { clsx } from "clsx";
import { Download } from "lucide-react";
import { api, stageNum } from "../api";
import { useStore } from "../store";
import { Empty, PaneHead } from "../ui/primitives";

/** Every execution of this run, newest first, each exportable as the files that rerun it. */
export function LedgerPage() {
  const run = useStore((s) => s.run);
  if (!run?.ledger.length) return <Empty>Every execution lands here with its parameters, and exports as the files that rerun it.</Empty>;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PaneHead title="Ledger" sub={`${run.id} · ${run.engine} · ${run.source === "demo" ? "synthetic inputs" : "your data"}`} />
      <ol className="min-h-0 flex-1 overflow-y-auto">
        {[...run.ledger].reverse().map((e) => {
          const ps = Object.entries(e.params);
          return (
            <li key={e.n} className="flex gap-3 border-b border-seam px-4 py-3">
              <span className={clsx("dot mt-1.5", e.status === "running" ? "dot-running" : e.status === "done" ? "dot-done" : e.status === "failed" ? "dot-failed" : "dot-pending")} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                  <span className="mono text-sm text-fg">#{e.n}</span>
                  <span className="mono text-xs text-fg-dim">stages {stageNum(e.stages[0])}–{stageNum(e.stages[1])}</span>
                  <span className="mono text-2xs text-fg-faint">{e.engine ?? run.engine}</span>
                  <span className="text-xs text-fg-faint">{new Date(e.started).toLocaleString()}</span>
                  {e.seconds != null && <span className="mono text-2xs text-fg-faint">{e.seconds < 90 ? `${e.seconds}s` : `${(e.seconds / 60).toFixed(1)} min`}</span>}
                  <span className={clsx("text-xs", e.status === "failed" ? "text-alert" : "text-fg-faint")}>{e.status}</span>
                </div>
                <div className="mono mt-1 text-2xs text-fg-dim">
                  {ps.length ? ps.map(([k, v]) => <span key={k} className="mr-3 inline-block"><span className="text-accent">{k}</span> = {JSON.stringify(v)}</span>)
                    : <span className="text-fg-faint">the code's own parameters</span>}
                </div>
              </div>
              {e.status !== "running" && (
                <a href={api.exportUrl(run.id, e.n)} className="flex h-6 shrink-0 items-center gap-1.5 self-start rounded-sm border border-seam px-2 text-xs text-fg-dim hover:border-seam-bright hover:text-fg">
                  <Download size={12} /> Rerun files
                </a>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
