import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Check, Wand2, Tags } from "lucide-react";
import { Panel } from "./Panel";
import { usePanelData } from "./usePanelData";
import { LinePlot, type Series } from "../../lib/plot/LinePlot";
import { paint } from "../../lib/plot/paint";
import { api, type ICAComponent, type Wire, type ICAComponentPSD } from "../../api/client";
import { applyOp, runOp } from "../../lib/ops";
import { clsx } from "clsx";
import { useStore } from "../../store/store";
import { useMediaQuery } from "../../lib/useMediaQuery";

export function ICA() {
  const session = useStore((s) => s.session);
  const hasIca = useStore((s) => s.hasIca);
  const windowStart = useStore((s) => s.windowStart);
  const windowDuration = useStore((s) => s.windowDuration);
  const t = useStore((s) => s.t);
  const themeTick = useStore((s) => s.themeTick);
  const theme = useStore((s) => s.resolvedTheme);
  const refreshHistory = useStore((s) => s.refreshHistory);
  const patchSession = useStore((s) => s.patchSession);
  const isDesktop = useMediaQuery("(min-width: 900px)");

  const id = session?.session_id;
  const [comps, setComps] = useState<ICAComponent[] | null>(null);
  const [topos, setTopos] = useState<Record<number, string>>({});
  const [selected, setSelected] = useState<number | null>(null);
  const [fitting, setFitting] = useState(false);
  const [nComp, setNComp] = useState("20");
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  const [labelling, setLabelling] = useState(false);
  /** Sort artifact components to the front once they are classified: the point
   *  of a classifier is that you stop scanning a grid in index order. */
  const [sortByLabel, setSortByLabel] = useState(true);

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

  // the PNGs carry the theme's ink baked in: a flip invalidates all of them
  useEffect(() => { setTopos({}); }, [theme]);

  // lazily fetch each component's topomap PNG
  useEffect(() => {
    if (!id || !comps) return;
    let cancelled = false;
    (async () => {
      for (const c of comps) {
        if (topos[c.index] || cancelled) continue;
        try {
          const r = await api.icaTopomap(id, c.index, theme);
          if (!cancelled) setTopos((prev) => ({ ...prev, [c.index]: r.png_base64 }));
        } catch {
          /* montage missing etc.: leave blank */
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, comps, theme]);

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

  const labelled = !!comps?.some((c) => c.label);

  const classify = async () => {
    setLabelling(true);
    try {
      await runOp("label_ica", {}, "Components classified");
      await loadComponents();
    } catch { /* runOp toasted */ } finally { setLabelling(false); }
  };

  const autoMark = async () => {
    setLabelling(true);
    try {
      await runOp("exclude_ica_by_label",
        { labels: ["muscle artifact", "eye blink", "heart beat", "line noise", "channel noise"],
          min_prob: 0.8 },
        "Artifact components marked");
      await loadComponents();
    } catch { /* runOp toasted */ } finally { setLabelling(false); }
  };

  const excluded = comps?.filter((c) => c.excluded).map((c) => c.index) ?? [];

  const ordered = useMemo(() => {
    if (!comps) return [];
    if (!sortByLabel || !labelled) return comps;
    const rank = (c: (typeof comps)[number]) =>
      c.label && c.label !== "brain" ? 0 : c.label === "brain" ? 2 : 1;
    return [...comps].sort((a, b) =>
      rank(a) - rank(b) || (b.label_prob ?? 0) - (a.label_prob ?? 0) || a.index - b.index);
  }, [comps, sortByLabel, labelled]);

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

  if (!session) return <Panel paneId="ica" title="ICA"><div /></Panel>;

  return (
    <Panel paneId="ica"
      container="ica"
      title={comps?.length
        ? `ICA · ${comps.length} components, unmixing Raw, ${session.n_channels} ch @ ${session.sfreq.toFixed(0)} Hz`
        : "ICA, independent components of Raw"}
      state="ready"
      right={
        comps?.length ? (
          applied ? (
            <span className="flex items-center gap-1 text-xs text-good"><Check size={11} /> applied to the signal</span>
          ) : (
            <div className="flex items-center gap-1.5">
            {!labelled ? (
              <button
                onClick={classify}
                disabled={labelling}
                title="ICLabel: classify every component brain / muscle / eye / heart / line noise"
                className="flex items-center gap-1 rounded-xs border border-seam px-2 py-0.5 text-xs
                           text-fg-dim transition-colors hover:border-seam-bright hover:text-fg disabled:opacity-40"
              >
                {labelling ? <Loader2 size={11} className="animate-spin" /> : <Tags size={11} />}
                Classify
              </button>
            ) : (
              <>
                <button
                  onClick={() => setSortByLabel((v) => !v)}
                  title="Sort the likely artifacts to the front"
                  className={clsx("rounded-xs border px-2 py-0.5 text-xs transition-colors",
                    sortByLabel ? "border-accent/50 bg-accent/10 text-accent"
                                : "border-seam text-fg-dim hover:text-fg")}
                >
                  artifacts first
                </button>
                <button
                  onClick={autoMark}
                  disabled={labelling}
                  title="Mark every component classified as an artifact with at least 80% confidence"
                  className="flex items-center gap-1 rounded-xs border border-seam px-2 py-0.5 text-xs
                             text-fg-dim transition-colors hover:border-seam-bright hover:text-fg disabled:opacity-40"
                >
                  {labelling ? <Loader2 size={11} className="animate-spin" /> : <Wand2 size={11} />}
                  Auto-mark
                </button>
              </>
            )}
            <button
              onClick={apply}
              disabled={!excluded.length || applying}
              className="flex items-center gap-1 rounded-xs border border-alert/40 bg-alert/12 px-2 py-0.5 text-xs font-medium text-alert hover:bg-alert/20 disabled:opacity-40"
            >
              {applying ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
              Apply: remove {excluded.length}
            </button>
            </div>
          )
        ) : null
      }
    >
      {!session.has_montage ? (
        <div className="flex h-full items-center justify-center p-6 text-center text-sm text-fg-faint">
          Set a montage first: ICA topographies need electrode positions.
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
        <div className={`flex h-full ${isDesktop ? "" : "flex-col"}`}>
          {/* component grid */}
          <div className="min-w-0 flex-1 overflow-y-auto p-2">
            <div className="mb-1.5 text-2xs text-fg-faint">
              click a component to inspect it · double-click to mark it for removal · the
              figure on the right of each name is the variance it explains
              {labelled && " · classes are ICLabel's, with its confidence"}
            </div>
            {/* 190px, not 132: you judge a component by looking at its map, and at
                132px a frontal-blink dipole and a temporal-muscle one are the same
                smudge. Bigger cards also stop fifteen components sitting in two
                rows at the top of an empty screen. auto-fill (not auto-fit) keeps
                the track size when there are too few to fill the row, so four
                components stay four cards rather than stretching to four columns
                of the whole width. */}
            <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2">
              {ordered.map((c) => (
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
                    <span
                      className="text-fg-faint"
                      title={c.variance_explained != null
                        ? `explains ${(c.variance_explained * 100).toFixed(1)}% of the variance`
                        : "variance not available"}
                    >
                      {c.variance_explained != null ? `${(c.variance_explained * 100).toFixed(0)}%` : "n/a"}
                    </span>
                  </div>
                  {c.label && (
                    <div
                      title={`ICLabel: ${c.label} (${((c.label_prob ?? 0) * 100).toFixed(0)}% confident)`}
                      className={clsx(
                        "mt-0.5 w-full truncate rounded-[2px] px-1 py-px text-center text-2xs",
                        c.label === "brain"
                          ? "bg-good/12 text-good"
                          : (c.label_prob ?? 0) >= 0.8
                            ? "bg-alert/15 text-alert"
                            : "bg-warn/12 text-warn",
                      )}
                    >
                      {c.label.replace(" artifact", "")} {((c.label_prob ?? 0) * 100).toFixed(0)}%
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* selected-component detail */}
          {/* On a phone an empty detail column would eat 42% of the screen to
              say "nothing selected": it appears only once there is something
              to show, and stacks under the grid instead of beside it. */}
          {/* the detail column earns its width only once there is something in
              it: an empty 42% pane saying "nothing selected" is the single
              largest piece of dead space in the app */}
          {selected != null && (
          <div className={isDesktop
            ? "flex w-[42%] min-w-0 shrink-0 flex-col border-l border-seam"
            : "flex h-[300px] min-w-0 shrink-0 flex-col border-t border-seam"}>
            {(
              <>
                <div className="flex items-center justify-between border-b border-seam px-2 py-1 text-xs">
                  <span className="text-fg">IC {selected}</span>
                  <button onClick={() => toggleExclude(selected)} className="text-accent hover:underline">
                    {excluded.includes(selected) ? "keep component" : "mark for removal"}
                  </button>
                </div>
                <div className="min-h-0 flex-1 border-b border-seam">
                  <div className="mono px-2 pt-1 text-2xs text-fg-faint">
                    activation · {windowStart.toFixed(1)}–{(windowStart + windowDuration).toFixed(1)}s, the same window as the waveform
                  </div>
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
          )}
        </div>
      )}
    </Panel>
  );
}
