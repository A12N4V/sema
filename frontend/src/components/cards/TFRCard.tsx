import { useMemo, useState } from "react";
import { BarChart3, Loader2 } from "lucide-react";
import { Panel, DataGate } from "../panels/Panel";
import { usePanelData } from "../panels/usePanelData";
import { Heatmap } from "../../lib/plot/Heatmap";
import { divergingTheme, ticks } from "../../lib/plot/scales";
import { paint } from "../../lib/plot/paint";
import { api, type TFRResult } from "../../api/client";
import { runOp } from "../../lib/ops";
import { useStore } from "../../store/store";
import { epochAt } from "../../lib/epochClock";
import { useSignatureKey } from "../../store/useSignatureKey";

/**
 * TIME-FREQUENCY: Morlet power over the epoch.
 *
 * Baseline-corrected in dB when the epoch has a pre-event window, because a raw
 * power spectrogram is dominated by the 1/f slope and shows nothing. Frequency
 * runs up the rows, which is the orientation every paper prints, so the shared
 * heatmap gets the matrix already flipped.
 */
export function TFRCard() {
  const session = useStore((s) => s.session);
  const capabilities = useStore((s) => s.capabilities);
  const focusChannel = useStore((s) => s.focusChannel);
  const setFocusChannel = useStore((s) => s.setFocusChannel);
  const themeTick = useStore((s) => s.themeTick);
  // The spectrogram runs on the epoch clock, so the transport cursor only means
  // something here while it is inside a trial. When it is, the highlighted
  // column follows it; when it is not, the column falls back to the event onset,
  // which is the reference every dB reading is made against anyway.
  const t = useStore((s) => s.t);
  const linked = epochAt(useStore((s) => s.epochsClock), t);
  const sigKey = useSignatureKey();
  const id = session?.session_id;
  const hasTfr = capabilities.includes("tfr");
  // dB against baseline: a decrease and an increase are opposite, not "less"
  const cmap = useMemo(() => {
    const p = paint(themeTick);
    return (v: number) => divergingTheme(v, p.panel, p.accent, p.alert);
  }, [themeTick]);
  const hasEpochs = capabilities.includes("epochs");

  const [busy, setBusy] = useState(false);
  const [fmin, setFmin] = useState("4");
  const [fmax, setFmax] = useState("40");

  const { data, state, error } = usePanelData<TFRResult | null>(
    () => (hasTfr ? api.tfr(id!, focusChannel ?? undefined) : Promise.resolve(null)),
    [id, sigKey, hasTfr, focusChannel],
    { enabled: !!id && hasTfr, label: "Time-frequency" },
  );

  /**
   * Normalised 0..1 for the shared heatmap, flipped so high frequency is up,
   * plus axes a reader can actually use.
   *
   * The labels are deliberately sparse and rounded. Labelling all 24 Morlet bins
   * gave a left margin reading 40, 38, 37, 35, 34, 32 … which is a list of
   * implementation details, not an axis: nobody wants to know where the linspace
   * fell. The same for time, where one label per Nth *sample* produced -0.20,
   * -0.07, 0.06. Both now snap to round numbers and label the nearest bin.
   */
  const { matrix, values, rowLabels, colLabels, zeroCol } = useMemo(() => {
    if (!data) {
      return { matrix: [] as number[][], values: [] as number[][],
               rowLabels: [] as string[], colLabels: [] as string[], zeroCol: undefined };
    }
    const lim = data.vlim || 1;
    const flipped = [...data.matrix].reverse();
    const freqsDown = [...data.freqs].reverse();

    /** Index of the bin closest to `v` in an array. */
    const nearest = (arr: number[], v: number) =>
      arr.reduce((best, x, i) => (Math.abs(x - v) < Math.abs(arr[best] - v) ? i : best), 0);

    const rowLabels = new Array<string>(freqsDown.length).fill("");
    for (const f of ticks(data.freqs[0], data.freqs[data.freqs.length - 1], 6)) {
      const i = nearest(freqsDown, f);
      rowLabels[i] = `${f.toFixed(0)} Hz`;
    }

    const t0 = data.times[0];
    const t1 = data.times[data.times.length - 1];
    const colLabels = new Array<string>(data.times.length).fill("");
    for (const tv of ticks(t0, t1, 7)) {
      const i = nearest(data.times, tv);
      colLabels[i] = `${tv.toFixed(tv === 0 ? 0 : 1)}s`;
    }

    // event onset: on a baseline-corrected spectrogram this is the reference
    // every reading is made against, and it was not drawn at all.
    const zeroCol = t0 <= 0 && t1 >= 0 ? nearest(data.times, 0) : undefined;

    return {
      matrix: flipped.map((row) => row.map((v) => (v + lim) / (2 * lim))),
      values: flipped,
      rowLabels,
      colLabels,
      zeroCol,
    };
  }, [data]);

  /** The column the highlight sits on: the cursor's latency if it maps into a
      trial, otherwise the event onset. */
  const cursorCol = useMemo(() => {
    if (!data || !linked) return zeroCol;
    let best = 0;
    for (let i = 1; i < data.times.length; i++) {
      if (Math.abs(data.times[i] - linked.latency) < Math.abs(data.times[best] - linked.latency)) best = i;
    }
    return best;
  }, [data, linked, zeroCol]);

  const compute = async () => {
    setBusy(true);
    try {
      await runOp("compute_tfr",
        { fmin: Number(fmin), fmax: Number(fmax), n_freqs: 24, decim: 3 },
        "Time-frequency computed");
    } catch { /* runOp toasted */ } finally { setBusy(false); }
  };

  if (!session) return <Panel paneId="tfr" title="Time-frequency"><div /></Panel>;

  if (!hasTfr) {
    return (
      <Panel paneId="tfr" title="Time-frequency">
        <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
          <BarChart3 size={26} className="text-fg-faint" />
          <div className="text-base text-fg">Morlet time-frequency</div>
          <div className="max-w-md text-xs leading-relaxed text-fg-dim">
            {hasEpochs
              ? "Power across the epoch at every frequency, baseline-corrected in dB."
              : "Create epochs first. Time-frequency is computed over trials."}
          </div>
          {hasEpochs && (
            <div className="flex items-end gap-2">
              <Field label="from" value={fmin} onChange={setFmin} suffix="Hz" />
              <Field label="to" value={fmax} onChange={setFmax} suffix="Hz" />
              <button
                onClick={compute}
                disabled={busy}
                className="flex items-center gap-1.5 rounded-xs border border-accent/40 bg-accent/12 px-3 py-1.5
                           text-sm font-medium text-accent hover:bg-accent/20 disabled:opacity-50"
              >
                {busy && <Loader2 size={12} className="animate-spin" />}
                {busy ? "Computing…" : "Compute"}
              </button>
            </div>
          )}
        </div>
      </Panel>
    );
  }

  return (
    <Panel
      paneId="tfr"
      container="tfr"
      title={data
        ? `Time-frequency · ${data.freqs[0].toFixed(0)} to ${data.freqs[data.freqs.length - 1].toFixed(0)} Hz, from Epochs`
        : "Time-frequency"}
      state={state}
      error={error}
      right={data && (
        <div className="flex items-center gap-2">
          <select
            value={focusChannel ?? ""}
            onChange={(e) => setFocusChannel(e.target.value || null)}
            aria-label="Channel for the spectrogram"
            className="mono rounded-xs border border-seam bg-bg px-1.5 py-0.5 text-2xs
                       outline-none focus:border-accent"
          >
            <option value="">all channels</option>
            {data.channels.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <ScaleLegend lim={data.vlim} unit={data.unit} cmap={cmap} />
        </div>
      )}
    >
      <DataGate state={state} error={error} emptyHint="Computing power…">
        {data && (
          <Heatmap
            matrix={matrix}
            values={values}
            valueLabel={data.unit}
            rowLabels={rowLabels}
            colLabels={colLabels}
            domain={[0, 1]}
            colormap={cmap}
            highlight={cursorCol != null ? { col: cursorCol } : undefined}
          />
        )}
      </DataGate>
    </Panel>
  );
}

/**
 * The colour ramp, with its two ends numbered.
 *
 * A diverging map is unreadable without one: "±17.4 dB" alone does not say
 * which end of the ramp is the increase, and on a baseline-corrected
 * spectrogram that is the entire question being asked.
 */
function ScaleLegend({ lim, unit, cmap }: {
  lim: number; unit: string; cmap: (t: number) => [number, number, number];
}) {
  const stops = Array.from({ length: 9 }, (_, i) => {
    const [r, g, b] = cmap(i / 8);
    return `rgb(${r},${g},${b}) ${(i / 8) * 100}%`;
  }).join(", ");
  return (
    <span className="flex items-center gap-1" title={`baseline-corrected power, ±${lim.toFixed(1)} ${unit}`}>
      <span className="mono text-2xs tabular-nums text-fg-faint">-{lim.toFixed(1)}</span>
      <span
        aria-hidden="true"
        className="h-2.5 w-16 rounded-[1px] border border-seam"
        style={{ background: `linear-gradient(to right, ${stops})` }}
      />
      <span className="mono text-2xs tabular-nums text-fg-faint">
        +{lim.toFixed(1)} {unit}
      </span>
    </span>
  );
}

function Field({ label, value, onChange, suffix }: {
  label: string; value: string; onChange: (v: string) => void; suffix?: string;
}) {
  return (
    <label className="flex flex-col gap-0.5 text-left">
      <span className="text-2xs text-fg-faint">{label}</span>
      <span className="flex items-baseline gap-1 rounded-xs border border-seam bg-bg px-1.5 py-1
                       focus-within:border-accent">
        <input value={value} onChange={(e) => onChange(e.target.value)} inputMode="decimal"
               className="mono w-[4ch] bg-transparent text-xs outline-none" />
        {suffix && <span className="text-2xs text-fg-faint">{suffix}</span>}
      </span>
    </label>
  );
}
