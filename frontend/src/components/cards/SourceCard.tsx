import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Brain } from "lucide-react";
import { Panel } from "../panels/Panel";
import { RenderedImage } from "./RenderedImage";
import { LinePlot, type Series } from "../../lib/plot/LinePlot";
import { Segmented } from "../ui/primitives";
import { api } from "../../api/client";
import { runOp } from "../../lib/ops";
import { paint } from "../../lib/plot/paint";
import { useStore } from "../../store/store";
import { useSignatureKey } from "../../store/useSignatureKey";

/**
 * Source workspace: the real `stc.plot()` inflated brain.
 * No stc yet → a gated "Compute source estimate" call (fetches fsaverage +
 * builds the forward solution on the first run, ~15-30 s, as a job).
 * stc present → the brain (cursor-linked) + the peak-vertex time course.
 */
export function SourceCard() {
  const session = useStore((s) => s.session);
  const t = useStore((s) => s.t);
  const setCursor = useStore((s) => s.setCursor);
  const themeTick = useStore((s) => s.themeTick);
  const sigKey = useSignatureKey();
  const id = session?.session_id;

  const [status, setStatus] = useState<{ has_stc: boolean; fsaverage_ready: boolean; meta: Record<string, unknown> } | null>(null);
  const [busy, setBusy] = useState(false);
  const [method, setMethod] = useState<"dSPM" | "sLORETA" | "eLORETA" | "MNE">("dSPM");
  const [hemi, setHemi] = useState<"lh" | "rh" | "both">("lh");
  const [view, setView] = useState<"lateral" | "medial" | "dorsal">("lateral");
  const [tc, setTc] = useState<{ t: number[]; y: number[]; label: string } | null>(null);

  const refresh = async () => {
    if (!id) return;
    try { setStatus(await api.sourceStatus(id)); } catch { /* */ }
  };
  useEffect(() => { void refresh(); /* eslint-disable-next-line */ }, [id, sigKey]);

  useEffect(() => {
    if (!id || !status?.has_stc) { setTc(null); return; }
    api.sourceTimecourse(id).then(setTc).catch(() => setTc(null));
  }, [id, status?.has_stc, sigKey]);

  const compute = async () => {
    if (!id) return;
    setBusy(true);
    try {
      await runOp("compute_source", { method, center_t: Math.round(t * 100) / 100 }, `Source estimate (${method})`);
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const meta = status?.meta ?? {};
  const win = status?.has_stc ? [Number(meta.tmin), Number(meta.tmax)] as [number, number] : null;
  const inWindow = win ? t >= win[0] && t <= win[1] : false;

  const tcSeries = useMemo<Series[]>(() => {
    if (!tc) return [];
    return [{ id: "tc", x: tc.t, y: tc.y, color: paint(themeTick).accent, width: 1.2 }];
  }, [tc, themeTick]);

  if (!session) return <Panel paneId="source" title="Source"><div /></Panel>;

  // --- no stc yet: the compute CTA ---
  if (!status?.has_stc) {
    return (
      <Panel paneId="source" title="Source: the inflated brain">
        <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
          <Brain size={26} className="text-fg-faint" />
          {!session.has_montage ? (
            <div className="max-w-xs text-xs text-fg-dim">
              Set a montage first: source localisation needs electrode positions.
            </div>
          ) : (
            <>
              <div className="text-base text-fg">Compute a source estimate</div>
              <div className="max-w-sm text-xs text-fg-dim">
                Template pipeline: fsaverage forward + ad-hoc covariance + minimum-norm inverse
                over an 8&nbsp;s window around the cursor. First run fetches fsaverage
                {status && !status.fsaverage_ready ? " (~770 MB)" : ""} and builds the forward
                solution (~15&nbsp;s).
              </div>
              <div className="flex items-center gap-2">
                <Segmented
                  value={method}
                  onChange={(m) => setMethod(m)}
                  options={[
                    { value: "dSPM", label: "dSPM" },
                    { value: "sLORETA", label: "sLORETA" },
                    { value: "MNE", label: "MNE" },
                  ]}
                />
                <button
                  onClick={compute}
                  disabled={busy}
                  className="flex items-center gap-1.5 rounded-xs border border-accent/40 bg-accent/12 px-3 py-1.5 text-sm font-medium text-accent hover:bg-accent/20 disabled:opacity-50"
                >
                  {busy && <Loader2 size={12} className="animate-spin" />}
                  {busy ? "Localising…" : "Compute"}
                </button>
              </div>
            </>
          )}
        </div>
      </Panel>
    );
  }

  // --- stc present: the brain + time course ---
  return (
    <Panel paneId="source"
      container="source"
      title={`Source · ${String(meta.method ?? "dSPM")}, inverse of Raw over ${Number(meta.tmin).toFixed(1)}–${Number(meta.tmax).toFixed(1)}s`}
      right={
        <div className="flex items-center gap-1.5">
          <Segmented size="xs" value={hemi} onChange={(h) => setHemi(h)}
            options={[{ value: "lh", label: "L" }, { value: "rh", label: "R" }, { value: "both", label: "L+R" }]} />
          <Segmented size="xs" value={view} onChange={(v) => setView(v)}
            options={[{ value: "lateral", label: "lat" }, { value: "medial", label: "med" }, { value: "dorsal", label: "dors" }]} />
        </div>
      }
    >
      <div className="flex h-full flex-col">
        <div className="min-h-0 flex-[3]">
          {inWindow ? (
            <RenderedImage
              spec={{ view: "brain", t: Math.round(t * 10) / 10, hemi, brain_view: view, width: 720, height: 560 }}
              deps={[sigKey, Math.round(t * 10) / 10, hemi, view]}
              alt="source estimate on the inflated brain"
              debounceMs={220}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-xs text-fg-faint">
              Cursor {t.toFixed(1)}s is outside the localised window [{win?.[0].toFixed(1)}–{win?.[1].toFixed(1)}s].
              <button
                onClick={compute}
                disabled={busy}
                className="rounded-xs border border-accent/40 bg-accent/10 px-2.5 py-1 text-accent hover:bg-accent/20 disabled:opacity-50"
              >
                {busy ? "Recomputing…" : "Recompute here"}
              </button>
            </div>
          )}
        </div>
        <div className="min-h-0 flex-[1] border-t border-seam">
          <div className="mono px-2 pt-1 text-2xs text-fg-faint">
            peak vertex activation {tc ? `· ${tc.label}` : ""}, click to move the shared cursor
          </div>
          {tcSeries.length > 0 && win && (
            <LinePlot
              series={tcSeries}
              xDomain={win}
              xLabel="s"
              yLabel={String(meta.method ?? "")}
              cursorX={t}
              onClickX={(x) => setCursor(x)}
            />
          )}
        </div>
      </div>
    </Panel>
  );
}
