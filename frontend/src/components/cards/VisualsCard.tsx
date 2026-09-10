import { useMemo, useRef, useState, type ReactNode } from "react";
import { RotateCcw, RotateCw, Move3d, MoveHorizontal } from "lucide-react";
import { Panel, DataGate } from "../panels/Panel";
import { usePanelData } from "../panels/usePanelData";
import { RenderedImage } from "./RenderedImage";
import { Segmented } from "../ui/primitives";
import { LinePlot, type Series, type VBand } from "../../lib/plot/LinePlot";
import { Heatmap } from "../../lib/plot/Heatmap";
import { api, type PSDResult, type BandPowerResult } from "../../api/client";
import { useStore } from "../../store/store";
import { useSignatureKey } from "../../store/useSignatureKey";
import { FRAME_SIZE } from "../../lib/figures";

/**
 * VISUALS: every read-only look at the current window/cursor (spatial and
 * spectral) sharing one pane as tabs, instead of four permanently-quartered
 * cards. Topography, the 3D field, spectrum and band power are all views of
 * the same underlying data at different resolutions.
 *
 * Two of these are mounted side by side on the Raw desktop layout, each with
 * its own tab: the pane is parameterised rather than a singleton, so you can
 * watch the topography and the spectrum move together instead of staring at
 * one map in a half-empty column.
 *
 * Everything here is *handled*, not just displayed: the topography scrubs the
 * recording under the drag, the 3D field orbits, the spectrum and the heatmap
 * read out values under the pointer. A figure you can only look at is a
 * screenshot.
 */
export type VisualTab = "topo" | "field3d" | "spectrum" | "bandpower";

const TABS: { value: VisualTab; label: string }[] = [
  { value: "topo", label: "Topography" },
  { value: "field3d", label: "3D field" },
  { value: "spectrum", label: "Spectrum" },
  { value: "bandpower", label: "Band power" },
];

export function VisualsCard({
  paneId = "visuals",
  initialTab = "topo",
  title = "Visualizations",
}: {
  paneId?: string;
  initialTab?: VisualTab;
  title?: string;
} = {}) {
  const [tab, setTab] = useState<VisualTab>(initialTab);

  return (
    <Panel
      paneId={paneId}
      title={title}
      right={<Segmented size="xs" value={tab} onChange={setTab} options={TABS} />}
    >
      {tab === "topo" && <TopographyBody />}
      {tab === "field3d" && <Field3DBody />}
      {tab === "spectrum" && <SpectrumBody />}
      {tab === "bandpower" && <BandPowerBody />}
    </Panel>
  );
}

/* --------------------------------------------------------------- topography */
function TopographyBody() {
  const session = useStore((s) => s.session);
  const t = useStore((s) => s.t);
  const band = useStore((s) => s.band);
  const seekTo = useStore((s) => s.seekTo);
  const sigKey = useSignatureKey();
  const [mode, setMode] = useState<"cursor" | "band" | "sensors">("cursor");
  const [scrubbing, setScrubbing] = useState(false);
  const tq = Math.round(t * 10) / 10;

  if (!session) return <div />;
  if (!session.has_montage) {
    return <NoMontage>run <span className="mono mx-1 text-fg-dim">Set montage</span> first</NoMontage>;
  }

  // FRAME_SIZE, not a size chosen for this pane: these three specs are exactly
  // what the precompute pass rendered, and a different size is a different cache
  // key: i.e. a fresh matplotlib run on every scrub. The <img> scales.
  const spec =
    mode === "cursor"
      ? { view: "topomap", source: "cursor", t: tq, width: FRAME_SIZE, height: FRAME_SIZE }
      : mode === "band"
        ? { view: "topomap", source: "band", band, width: FRAME_SIZE, height: FRAME_SIZE }
        : { view: "sensors", width: FRAME_SIZE, height: FRAME_SIZE };

  /**
   * Drag anywhere on the map to sweep the whole recording through it. This is
   * what the precomputed filmstrip is *for*: the frames already exist, so the
   * scalp field animates under the finger instead of chasing it. The time is
   * baked into the figure, so what you are watching is never ambiguous.
   */
  const scrub = (clientX: number, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    seekTo(f * session.duration_seconds);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-seam px-2 py-1">
        {mode === "cursor" && (
          <span className="mono flex items-center gap-1 text-2xs text-fg-faint max-[520px]:hidden">
            <MoveHorizontal size={10} /> drag to sweep
          </span>
        )}
        <Segmented
          size="xs"
          value={mode}
          onChange={setMode}
          options={[
            { value: "cursor", label: "at cursor" },
            { value: "band", label: band },
            { value: "sensors", label: "sensors" },
          ]}
        />
      </div>
      <div
        className={`min-h-0 flex-1 ${mode === "cursor" ? "cursor-ew-resize touch-none select-none" : ""}`}
        onPointerDown={mode === "cursor" ? (e) => {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          setScrubbing(true);
          scrub(e.clientX, e.currentTarget);
        } : undefined}
        onPointerMove={mode === "cursor" ? (e) => {
          if (scrubbing) scrub(e.clientX, e.currentTarget);
        } : undefined}
        onPointerUp={() => setScrubbing(false)}
        onPointerCancel={() => setScrubbing(false)}
      >
        <RenderedImage
          spec={spec}
          deps={[sigKey, mode, mode === "cursor" ? tq : band]}
          alt={mode === "sensors" ? "sensor layout" : "scalp topography"}
          debounceMs={mode === "cursor" ? 40 : 120}
        />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- 3D field */
function Field3DBody() {
  const session = useStore((s) => s.session);
  const t = useStore((s) => s.t);
  const sigKey = useSignatureKey();
  const [cam, setCam] = useState({ az: -35, el: 16 });
  const drag = useRef<{ x: number; y: number; az: number; el: number } | null>(null);
  const tq = Math.round(t * 10) / 10;

  if (!session) return <div />;
  if (!session.has_montage) {
    return <NoMontage>run <span className="mono mx-1 text-fg-dim">Set montage</span> to place electrodes</NoMontage>;
  }

  // Orbit by dragging the head itself. Elevation is clamped short of the poles
  // where the camera-up vector degenerates and the render flips.
  const onMove = (clientX: number, clientY: number) => {
    const d = drag.current;
    if (!d) return;
    setCam({
      az: d.az + (clientX - d.x) * 0.6,
      el: Math.max(-70, Math.min(70, d.el - (clientY - d.y) * 0.5)),
    });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-seam px-2 py-1">
        <span className="mono flex items-center gap-1 text-2xs text-fg-faint max-[520px]:hidden">
          <Move3d size={10} /> drag to orbit
        </span>
        <span className="mono ml-auto text-2xs tabular-nums text-fg-faint">
          az {cam.az.toFixed(0)}° · el {cam.el.toFixed(0)}°
        </span>
        <button className="rounded px-0.5 text-fg-dim transition-colors hover:text-fg" title="rotate left"
                onClick={() => setCam((c) => ({ ...c, az: c.az - 30 }))}>
          <RotateCcw size={11} />
        </button>
        <button className="rounded px-0.5 text-fg-dim transition-colors hover:text-fg" title="rotate right"
                onClick={() => setCam((c) => ({ ...c, az: c.az + 30 }))}>
          <RotateCw size={11} />
        </button>
      </div>
      <div
        className="min-h-0 flex-1 cursor-grab touch-none select-none active:cursor-grabbing"
        onPointerDown={(e) => {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, az: cam.az, el: cam.el };
        }}
        onPointerMove={(e) => onMove(e.clientX, e.clientY)}
        onPointerUp={() => { drag.current = null; }}
        onPointerCancel={() => { drag.current = null; }}
        onDoubleClick={() => setCam({ az: -35, el: 16 })}
      >
        <RenderedImage
          spec={{ view: "field3d", t: tq, azimuth: Math.round(cam.az), elevation: Math.round(cam.el),
                  width: 560, height: 500 }}
          deps={[sigKey, tq, Math.round(cam.az), Math.round(cam.el)]}
          alt="3D scalp field"
          debounceMs={140}
        />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- spectrum */
const PSD_BANDS: VBand[] = [
  { from: 1, to: 4, color: "rgba(79,176,255,0.04)", label: "δ" },
  { from: 4, to: 8, color: "rgba(79,176,255,0.07)", label: "θ" },
  { from: 8, to: 13, color: "rgba(79,176,255,0.11)", label: "α" },
  { from: 13, to: 30, color: "rgba(79,176,255,0.06)", label: "β" },
  { from: 30, to: 45, color: "rgba(79,176,255,0.03)", label: "γ" },
];

function SpectrumBody() {
  const session = useStore((s) => s.session);
  const selected = useStore((s) => s.selectedChannels);
  const focusChannel = useStore((s) => s.focusChannel);
  const setBand = useStore((s) => s.setBand);

  const id = session?.session_id;
  const sigKey = useSignatureKey();
  const picks = selected.length ? selected : session?.channel_names ?? [];

  const { data, state, error } = usePanelData<PSDResult>(
    () => api.psd(id!, 1, 45, picks),
    [id, sigKey, picks.join(",")],
    { enabled: !!id, label: "PSD" },
  );

  const series = useMemo<Series[]>(() => {
    if (!data) return [];
    const { freqs, channels, psd_db } = data;
    const mean = freqs.map((_, fi) => psd_db.reduce((a, row) => a + row[fi], 0) / channels.length);
    const out: Series[] = [];
    for (let i = 0; i < channels.length && i < 40; i++) {
      out.push({ id: channels[i], x: freqs, y: psd_db[i], color: "rgba(120,120,132,0.28)", width: 0.6 });
    }
    const fi = channels.indexOf(focusChannel ?? "");
    if (fi >= 0) out.push({ id: channels[fi], x: freqs, y: psd_db[fi], color: "#4fb0ff", width: 1.4 });
    out.push({ id: "mean", x: freqs, y: mean, color: "#d7d7d7", width: 1.6 });
    return out;
  }, [data, focusChannel]);

  const bandForFreq = (f: number) =>
    f < 4 ? "delta" : f < 8 ? "theta" : f < 13 ? "alpha" : f < 30 ? "beta" : "gamma";

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-seam px-2 py-1">
        <span className="mono text-2xs text-fg-faint max-[520px]:hidden">click a frequency to pick its band</span>
        <span className="mono ml-auto text-2xs text-fg-faint">{picks.length} ch</span>
      </div>
      <div className="min-h-0 flex-1">
        <DataGate state={state} error={error} emptyHint="Computing PSD…">
          {data && (
            <LinePlot
              series={series}
              xDomain={[1, 45]}
              logX
              xLabel="Hz"
              yLabel="dB µV²/Hz"
              bands={PSD_BANDS}
              onClickX={(f) => setBand(bandForFreq(f))}
            />
          )}
        </DataGate>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- band power */
const BAND_ORDER = ["delta", "theta", "alpha", "beta", "gamma"];
const BAND_SHORT = ["δ 1–4", "θ 4–8", "α 8–13", "β 13–30", "γ 30–45"];

function BandPowerBody() {
  const session = useStore((s) => s.session);
  const band = useStore((s) => s.band);
  const focusChannel = useStore((s) => s.focusChannel);
  const setBand = useStore((s) => s.setBand);
  const setFocusChannel = useStore((s) => s.setFocusChannel);

  const id = session?.session_id;
  const sigKey = useSignatureKey();

  const { data, state, error } = usePanelData<BandPowerResult>(
    () => api.bandPower(id!),
    [id, sigKey],
    { enabled: !!id, label: "Band power" },
  );

  const { matrix, raw, rowLabels } = useMemo(() => {
    if (!data) return { matrix: [] as number[][], raw: [] as number[][], rowLabels: [] as string[] };
    const cols = BAND_ORDER.map((b) => data.bands[b].map((v) => Math.log10(v + 1e-20)));
    const norm = cols.map((col) => {
      const s = [...col].sort((a, b) => a - b);
      const lo = s[Math.floor(s.length * 0.05)];
      const hi = s[Math.ceil(s.length * 0.95) - 1];
      return col.map((v) => (hi > lo ? Math.max(0, Math.min(1, (v - lo) / (hi - lo))) : 0.5));
    });
    const m = data.channels.map((_, ci) => norm.map((col) => col[ci]));
    // µV²/Hz, the number a reader would actually quote
    const r = data.channels.map((_, ci) => BAND_ORDER.map((b) => data.bands[b][ci] * 1e12));
    return { matrix: m, raw: r, rowLabels: data.channels };
  }, [data]);

  const colIdx = BAND_ORDER.indexOf(band);
  const rowIdx = data ? data.channels.indexOf(focusChannel ?? "") : -1;

  return (
    <DataGate state={state} error={error} emptyHint="Computing band power…">
      {data && (
        <Heatmap
          matrix={matrix}
          values={raw}
          valueLabel="µV²/Hz"
          rowLabels={rowLabels}
          colLabels={BAND_SHORT}
          domain={[0, 1]}
          highlight={{ col: colIdx >= 0 ? colIdx : undefined, row: rowIdx >= 0 ? rowIdx : undefined }}
          onCell={(r, c) => {
            setBand(BAND_ORDER[c]);
            setFocusChannel(data.channels[r]);
          }}
        />
      )}
    </DataGate>
  );
}

const NoMontage = ({ children }: { children: ReactNode }) => (
  <div className="flex h-full items-center justify-center p-6 text-center text-xs text-fg-faint">
    No montage: {children}.
  </div>
);
