import { useMemo, useState } from "react";
import { Grid3x3, Loader2 } from "lucide-react";
import { Panel, DataGate } from "../panels/Panel";
import { usePanelData } from "../panels/usePanelData";
import { Heatmap } from "../../lib/plot/Heatmap";
import { divergingTheme } from "../../lib/plot/scales";
import { paint } from "../../lib/plot/paint";
import { api, type EpochsImage, type EpochsSummary } from "../../api/client";
import { runOp } from "../../lib/ops";
import { useStore } from "../../store/store";
import { useSignatureKey } from "../../store/useSignatureKey";
import { epochAt, recordingTimeOf } from "../../lib/epochClock";

/**
 * EPOCHS: the node the whole epoched half of MNE hangs off, and the one this
 * project did not have.
 *
 * The pane is the ERP image, which is how epochs are actually inspected: every
 * trial as a row, so a drifting electrode or a subject who moved halfway
 * through is a visible band rather than a number in a drop log. The drop log is
 * there too, because "how many trials survived" is the first question anyone
 * asks of an average.
 */
export function EpochsCard() {
  const session = useStore((s) => s.session);
  const capabilities = useStore((s) => s.capabilities);
  const focusChannel = useStore((s) => s.focusChannel);
  const setFocusChannel = useStore((s) => s.setFocusChannel);
  const themeTick = useStore((s) => s.themeTick);
  const sigKey = useSignatureKey();
  const id = session?.session_id;
  const hasEpochs = capabilities.includes("epochs");
  // µV is signed and has a real zero, so it wants a diverging ramp
  const cmap = useMemo(() => {
    const p = paint(themeTick);
    return (v: number) => divergingTheme(v, p.panel, p.accent, p.alert);
  }, [themeTick]);

  // The ERP image is a picture of the whole recording laid out as rows, so it
  // is the one epoched pane where the transport cursor has an unambiguous
  // place: it is inside exactly one trial, at one latency. Highlight both, and
  // let a click on any cell drag the cursor back there.
  const t = useStore((st) => st.t);
  const setCursor = useStore((st) => st.setCursor);
  const clock = useStore((st) => st.epochsClock);
  const linked = epochAt(clock, t);

  const [busy, setBusy] = useState(false);
  const [tmin, setTmin] = useState("-0.2");
  const [tmax, setTmax] = useState("0.8");
  const [reject, setReject] = useState("150");

  const summary = usePanelData<EpochsSummary | null>(
    () => (hasEpochs ? api.epochsSummary(id!) : Promise.resolve(null)),
    [id, sigKey, hasEpochs],
    { enabled: !!id && hasEpochs, label: "Epochs" },
  );

  const channel = focusChannel && summary.data?.channels.includes(focusChannel)
    ? focusChannel
    : summary.data?.channels[0];

  const image = usePanelData<EpochsImage | null>(
    () => (channel ? api.epochsImage(id!, channel) : Promise.resolve(null)),
    [id, sigKey, channel],
    { enabled: !!id && !!channel, label: "ERP image" },
  );

  const matrix = useMemo(() => {
    if (!image.data) return [] as number[][];
    const lim = image.data.vlim || 1;
    // normalised to 0..1 for the shared heatmap, which owns the colour ramp
    return image.data.matrix.map((row) => row.map((v) => (v + lim) / (2 * lim)));
  }, [image.data]);

  const create = async () => {
    setBusy(true);
    try {
      await runOp("make_epochs", {
        tmin: Number(tmin), tmax: Number(tmax), baseline: true,
        reject_uv: reject.trim() === "" ? null : Number(reject),
      }, "Epochs created");
    } catch { /* runOp toasted */ } finally { setBusy(false); }
  };

  if (!session) return <Panel paneId="epochs" title="Epochs"><div /></Panel>;

  if (!hasEpochs) {
    return (
      <Panel paneId="epochs" title="Epochs">
        <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
          <Grid3x3 size={26} className="text-fg-faint" />
          <div className="text-base text-fg">Cut the recording into trials</div>
          <div className="max-w-md text-xs leading-relaxed text-fg-dim">
            Epochs are taken around your annotations. A recording with no events is cut
            on a fixed grid instead, so a resting session still reaches evoked responses
            and time-frequency. This is the node that gates both.
          </div>
          <div className="flex flex-wrap items-end justify-center gap-2">
            <Field label="tmin" value={tmin} onChange={setTmin} suffix="s" />
            <Field label="tmax" value={tmax} onChange={setTmax} suffix="s" />
            <Field label="reject above" value={reject} onChange={setReject} suffix="µV" width="5ch" />
            <button
              onClick={create}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-xs border border-accent/40 bg-accent/12 px-3 py-1.5
                         text-sm font-medium text-accent hover:bg-accent/20 disabled:opacity-50"
            >
              {busy && <Loader2 size={12} className="animate-spin" />}
              {busy ? "Cutting…" : "Create epochs"}
            </button>
          </div>
        </div>
      </Panel>
    );
  }

  const s = summary.data;
  return (
    <Panel
      paneId="epochs"
      container="epochs"
      title={s
        ? `Epochs · ${s.n_epochs} trials · ${s.tmin.toFixed(2)} to ${s.tmax.toFixed(2)}s of Raw`
        : "Epochs"}
      state={summary.state}
      error={summary.error}
      right={
        s && (
          <div className="flex items-center gap-2 text-2xs">
            {Object.entries(s.conditions).map(([name, n]) => (
              <span key={name} className="mono rounded-full border border-seam px-2 py-0.5 text-fg-dim">
                {name} {n}
              </span>
            ))}
            <span className={s.n_dropped ? "text-warn" : "text-fg-faint"}
                  title={s.dropped.slice(0, 8).map((d) => `#${d.index}: ${d.reason}`).join("\n")}>
              {s.n_dropped} dropped ({s.drop_percent.toFixed(0)}%)
            </span>
          </div>
        )
      }
    >
      <div className="flex h-full flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b border-seam px-2 py-1">
          <span className="text-2xs text-fg-faint">
            {linked
              ? `ERP image · cursor is in trial ${linked.index + 1} at ${(linked.latency * 1000).toFixed(0)} ms`
              : "ERP image, one row per trial · click a cell to jump there"}
          </span>
          <select
            value={channel ?? ""}
            onChange={(e) => setFocusChannel(e.target.value)}
            aria-label="Channel for the ERP image"
            className="mono ml-auto rounded-xs border border-seam bg-bg px-1.5 py-0.5 text-2xs
                       outline-none focus:border-accent"
          >
            {(s?.channels ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          {image.data && (
            <span className="mono text-2xs text-fg-faint">±{image.data.vlim.toFixed(0)} µV</span>
          )}
        </div>
        <div className="min-h-0 flex-1">
          <DataGate state={image.state} error={image.error} emptyHint="Building the ERP image…">
            {image.data && (
              <Heatmap
                matrix={matrix}
                values={image.data.matrix}
                valueLabel="µV"
                rowLabels={image.data.matrix.map((_, i) => `#${i}`)}
                colLabels={image.data.times.map((v, i) =>
                  i % Math.ceil(image.data!.times.length / 8) === 0 ? `${v.toFixed(2)}s` : "")}
                domain={[0, 1]}
                colormap={cmap}
                highlight={linked ? { row: linked.index } : undefined}
                onCell={(row, col) => {
                  const rt = recordingTimeOf(clock, row, image.data!.times[col]);
                  if (rt !== null) setCursor(rt);
                }}
              />
            )}
          </DataGate>
        </div>
      </div>
    </Panel>
  );
}

function Field({ label, value, onChange, suffix, width = "4ch" }: {
  label: string; value: string; onChange: (v: string) => void; suffix?: string; width?: string;
}) {
  return (
    <label className="flex flex-col gap-0.5 text-left">
      <span className="text-2xs text-fg-faint">{label}</span>
      <span className="flex items-baseline gap-1 rounded-xs border border-seam bg-bg px-1.5 py-1
                       focus-within:border-accent">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          inputMode="decimal"
          style={{ width }}
          className="mono bg-transparent text-xs outline-none"
        />
        {suffix && <span className="text-2xs text-fg-faint">{suffix}</span>}
      </span>
    </label>
  );
}
