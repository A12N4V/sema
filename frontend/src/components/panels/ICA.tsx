import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Check } from "lucide-react";
import { Panel } from "./Panel";
import { usePanelData } from "./usePanelData";
import { LinePlot, type Series } from "../../lib/plot/LinePlot";
import { paint } from "../../lib/plot/paint";
import { api, type ICAComponent, type Wire, type ICAComponentPSD } from "../../api/client";
import { applyOp } from "../../lib/ops";
import { useStore } from "../../store/store";

export function ICA() {
  const session = useStore((s) => s.session);
  const hasIca = useStore((s) => s.hasIca);
  const windowStart = useStore((s) => s.windowStart);
  const windowDuration = useStore((s) => s.windowDuration);
  const t = useStore((s) => s.t);
  const themeTick = useStore((s) => s.themeTick);
  const refreshHistory = useStore((s) => s.refreshHistory);
  const patchSession = useStore((s) => s.patchSession);

  const id = session?.session_id;
  const [comps, setComps] = useState<ICAComponent[] | null>(null);
  const [topos, setTopos] = useState<Record<number, string>>({});
  const [selected, setSelected] = useState<number | null>(null);
  const [fitting, setFitting] = useState(false);
  const [nComp, setNComp] = useState("20");
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);

  const loadComponents = async () => {
    if (!id) return;
    try {
      const r = await api.icaComponents(id);
      setComps(r.components);
    } catch {
      setComps([]);
    }
  };

  useEffect(() => {
    if (id && hasIca) loadComponents();
    else setComps([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, hasIca]);

  // lazily fetch each component's topomap PNG
  useEffect(() => {
    if (!id || !comps) return;
    let cancelled = false;
    (async () => {
      for (const c of comps) {
        if (topos[c.index] || cancelled) continue;
        try {
          const r = await api.icaTopomap(id, c.index);
          if (!cancelled) setTopos((prev) => ({ ...prev, [c.index]: r.png_base64 }));
        } catch {
          /* montage missing etc. — leave blank */
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, comps]);

  const fit = async () => {
    if (!id) return;
    setFitting(true);
    try {
      const n = Number(nComp);
      await api.fitIca(id, n > 0 && n < 1 ? n : Math.round(n));
      setApplied(false);
      patchSession(await api.getSession(id));
      await refreshHistory();
      await loadComponents();
      toast.success("ICA fitted");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setFitting(false);
    }
  };

  const toggleExclude = async (index: number) => {
    if (!id || !comps) return;
    const next = comps.some((c) => c.index === index && c.excluded)
      ? comps.filter((c) => c.excluded).map((c) => c.index).filter((i) => i !== index)
      : [...comps.filter((c) => c.excluded).map((c) => c.index), index];
    try {
      const r = await api.icaExclude(id, next);
      setComps(r.components);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const excluded = comps?.filter((c) => c.excluded).map((c) => c.index) ?? [];

  const apply = async () => {
    if (!id || !excluded.length) return;
    setApplying(true);
    try {
      await applyOp(async () => {
        await api.applyIca(id);
        return api.getSession(id);
      }, `Removed ${excluded.length} component${excluded.length > 1 ? "s" : ""}`);
      setSelected(null);
      setApplied(true);
      await loadComponents();
    } finally {
      setApplying(false);
    }
  };

  /* ---- selected-component detail: source time course + PSD ---- */
  const sources = usePanelData<Wire | null>(
    () => (id && selected != null ? api.icaSources(id, { start: windowStart, duration: windowDuration, max_points: 1800 }) : Promise.resolve(null)),
    [id, selected, windowStart, windowDuration],
    { enabled: !!id && selected != null, label: "IC sources" },
  );
  const psd = usePanelData<ICAComponentPSD | null>(
    () => (id && selected != null ? api.icaComponentPsd(id, selected) : Promise.resolve(null)),
    [id, selected],
    { enabled: !!id && selected != null, label: "IC spectrum" },
  );

  const srcSeries = useMemo<Series[]>(() => {
    if (selected == null || !sources.data) return [];
    const key = `IC ${selected}`;
    const y = sources.data.data[key];
    if (!y) return [];
    return [{ id: key, x: sources.data.time, y, color: paint(themeTick).accent, width: 1 }];
  }, [selected, sources.data, themeTick]);

  const psdSeries = useMemo<Series[]>(() => {
    if (!psd.data) return [];
    return [{ id: "psd", x: psd.data.freqs, y: psd.data.psd_db, color: paint(themeTick).text, width: 1.2 }];
  }, [psd.data, themeTick]);

  if (!session) return <Panel title="ICA"><div /></Panel>;

  return (
    <Panel
      title="ICA — independent components"
      state="ready"
      right={
        comps?.length ? (
          applied ? (
            <span className="flex items-center gap-1 text-xs text-good"><Check size={11} /> applied to the signal</span>
          ) : (
            <button
              onClick={apply}
              disabled={!excluded.length || applying}
              className="flex items-center gap-1 rounded-xs border border-alert/40 bg-alert/12 px-2 py-0.5 text-xs font-medium text-alert hover:bg-alert/20 disabled:opacity-40"
            >
              {applying ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
              Apply — remove {excluded.length}
            </button>
          )
        ) : null
      }
    >
      {!session.has_montage ? (
        <div className="flex h-full items-center justify-center p-6 text-center text-sm text-fg-faint">
          Set a montage first — ICA topographies need electrode positions.
        </div>
      ) : !comps?.length ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
          <div className="text-base text-fg">Fit ICA</div>
          <div className="max-w-xs text-xs text-fg-dim">
            Filter to ≥1 Hz first. Whole number = component count; &lt;1 = variance fraction kept.
          </div>
          <div className="flex items-center gap-2">
            <input
              className="w-24 rounded-xs border border-seam bg-bg px-2 py-1.5 text-sm text-fg outline-none focus:border-accent"
              value={nComp}
              onChange={(e) => setNComp(e.target.value)}
            />
            <button
              onClick={fit}
              disabled={fitting}
              className="flex items-center gap-1.5 rounded-xs border border-accent/40 bg-accent/12 px-3 py-1.5 text-sm font-medium text-accent hover:bg-accent/20 disabled:opacity-50"
            >
              {fitting ? <Loader2 size={12} className="animate-spin" /> : null}
              {fitting ? "Fitting…" : "Fit ICA"}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex h-full">
          {/* component grid */}
          <div className="min-w-0 flex-1 overflow-y-auto p-2">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-2">
              {comps.map((c) => (
                <button
                  key={c.index}
                  onClick={() => setSelected(c.index === selected ? null : c.index)}
                  onDoubleClick={() => toggleExclude(c.index)}
                  className={`flex flex-col items-center rounded-xs border p-1 transition-colors ${
                    c.excluded
                      ? "border-alert bg-alert/5"
                      : c.index === selected
                      ? "border-accent bg-accent/5"
                      : "border-seam hover:border-seam-bright"
                  }`}
                  title="click to inspect · double-click to toggle removal"
                >
                  <div className="flex aspect-square w-full items-center justify-center rounded-[2px] bg-panel-2">
                    {topos[c.index] ? (
                      <img src={`data:image/png;base64,${topos[c.index]}`} alt={`IC ${c.index}`} className={`h-full w-full object-contain ${c.excluded ? "opacity-50" : ""}`} />
                    ) : (
                      <Loader2 size={12} className="animate-spin text-fg-faint" />
                    )}
                  </div>
                  <div className="mt-0.5 flex w-full items-center justify-between px-0.5 text-2xs">
                    <span className={c.excluded ? "text-alert" : c.index === selected ? "text-accent" : "text-fg-dim"}>IC {c.index}</span>
                    <span className="text-fg-faint">{c.variance_explained != null ? `${(c.variance_explained * 100).toFixed(0)}%` : "—"}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* selected-component detail */}
          <div className="flex w-[42%] min-w-0 shrink-0 flex-col border-l border-seam">
            {selected == null ? (
              <div className="flex h-full items-center justify-center p-4 text-center text-xs text-fg-faint">
                Select a component to see its time course and spectrum.
                <br />Double-click a card to mark it for removal.
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between border-b border-seam px-2 py-1 text-xs">
                  <span className="text-fg">IC {selected}</span>
                  <button onClick={() => toggleExclude(selected)} className="text-accent hover:underline">
                    {excluded.includes(selected) ? "keep component" : "mark for removal"}
                  </button>
                </div>
                <div className="min-h-0 flex-1 border-b border-seam">
                  <div className="px-2 pt-1 text-2xs text-fg-faint">activation · current window</div>
                  {srcSeries.length > 0 && (
                    <LinePlot series={srcSeries} xDomain={[windowStart, windowStart + windowDuration]} xLabel="s" cursorX={t} />
                  )}
                </div>
                <div className="min-h-0 flex-1">
                  <div className="px-2 pt-1 text-2xs text-fg-faint">spectrum</div>
                  {psdSeries.length > 0 && (
                    <LinePlot series={psdSeries} xDomain={[1, 45]} logX xLabel="Hz" yLabel="dB" />
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}
