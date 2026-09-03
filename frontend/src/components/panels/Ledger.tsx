import { useState } from "react";
import { toast } from "sonner";
import { Undo2, FileDown, FileText, Table2 } from "lucide-react";
import { Panel } from "./Panel";
import { api } from "../../api/client";
import { useStore } from "../../store/store";

export function Ledger() {
  const session = useStore((s) => s.session);
  const history = useStore((s) => s.history);
  const refreshHistory = useStore((s) => s.refreshHistory);
  const patchSession = useStore((s) => s.patchSession);
  const loadLayout = useStore((s) => s.loadLayout);
  const [sel, setSel] = useState<number | null>(null);
  const id = session?.session_id;

  const revert = async (seq: number) => {
    if (!id) return;
    try {
      patchSession(await api.revert(id, seq));
      await refreshHistory();
      await loadLayout();
      setSel(null);
      toast.success(seq === 0 ? "Reverted to pristine" : `Reverted to step ${seq}`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <Panel title="History" fkey="F6" state="ready"
      right={
        <div className="flex items-center gap-2 text-fg-dim">
          <a href={id ? api.exportPipelineUrl(id) : "#"} target="_blank" rel="noreferrer" title="pipeline.py" className="hover:text-fg"><FileText size={12} /></a>
          <a href={id ? api.exportSummaryUrl(id) : "#"} target="_blank" rel="noreferrer" title="summary.csv" className="hover:text-fg"><Table2 size={12} /></a>
          <a href={id ? api.exportRawUrl(id) : "#"} target="_blank" rel="noreferrer" title="cleaned .fif" className="hover:text-fg"><FileDown size={12} /></a>
        </div>
      }
    >
      <div className="flex h-full flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <button
            onClick={() => revert(0)}
            className="flex w-full items-center gap-2 border-b border-seam/50 px-2 py-1 text-left text-xs text-fg-faint hover:bg-panel-2 hover:text-fg-dim"
          >
            <span className="mono w-5 text-right">0</span> pristine · original recording
          </button>
          {history.map((h) => (
            <div key={h.seq}>
              <button
                onClick={() => setSel(sel === h.seq ? null : h.seq)}
                className={`flex w-full items-start gap-2 border-b border-seam/40 px-2 py-1 text-left text-xs hover:bg-panel-2 ${sel === h.seq ? "bg-panel-2 text-fg" : "text-fg-dim"}`}
              >
                <span className="mono w-5 shrink-0 text-right text-fg-faint">{h.seq}</span>
                <span className="flex-1">{h.label}</span>
                {!h.replayable && <span className="mono text-2xs text-warn">snap</span>}
              </button>
              {sel === h.seq && (
                <div className="border-b border-seam/40 bg-panel-2 px-3 py-2 text-2xs">
                  <pre className="mono overflow-x-auto whitespace-pre-wrap text-fg-dim">{h.rendered}</pre>
                  <div className="mono mt-1 flex gap-3 text-fg-faint">
                    {"highpass" in h.info_after && <span>hp {String(h.info_after.highpass)}</span>}
                    {"lowpass" in h.info_after && <span>lp {String(h.info_after.lowpass)}</span>}
                    {"sfreq" in h.info_after && <span>{String(h.info_after.sfreq)} Hz</span>}
                    {"n_bads" in h.info_after && <span>{String(h.info_after.n_bads)} bad</span>}
                  </div>
                  <button
                    onClick={() => revert(h.seq)}
                    className="mt-1.5 flex items-center gap-1 text-accent hover:underline"
                  >
                    <Undo2 size={10} /> revert to here
                  </button>
                </div>
              )}
            </div>
          ))}
          {!history.length && (
            <div className="p-3 text-xs text-fg-faint">No steps yet.</div>
          )}
        </div>
      </div>
    </Panel>
  );
}
