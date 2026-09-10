import { useMemo, useState } from "react";
import { Activity, Loader2 } from "lucide-react";
import { Panel } from "../panels/Panel";
import { usePanelData } from "../panels/usePanelData";
import { LinePlot, type Series } from "../../lib/plot/LinePlot";
import { RenderedImage } from "./RenderedImage";
import { paint } from "../../lib/plot/paint";
import { api, type EvokedResult } from "../../api/client";
import { runOp } from "../../lib/ops";
import { useStore } from "../../store/store";
import { useSignatureKey } from "../../store/useSignatureKey";
import { FRAME_SIZE } from "../../lib/figures";
import { epochAt, recordingTimeOf } from "../../lib/epochClock";

/**
 * EVOKED: the condition average, drawn the way it is read.
 *
 * The butterfly with GFP on top of it, and a topography at whatever latency you
 * put the cursor on. That pairing is the whole point of an evoked plot: a bump
 * in the GFP is only interesting once you can see where on the head it sits, and
 * clicking the trace moves the map.
 */
export function EvokedCard() {
  const session = useStore((s) => s.session);
  const capabilities = useStore((s) => s.capabilities);
  const themeTick = useStore((s) => s.themeTick);
  const focusChannel = useStore((s) => s.focusChannel);
  const sigKey = useSignatureKey();
  const id = session?.session_id;
  const hasEvoked = capabilities.includes("evoked");
  const hasEpochs = capabilities.includes("epochs");

  const [busy, setBusy] = useState(false);
  /**
   * Latency inside the epoch, which is a different clock from the recording.
   * `null` means "follow the transport cursor": while it maps into a trial the
   * butterfly, the topography and the waveform below all sit at the same
   * instant, and dragging the cursor moves this map. Clicking the trace pins a
   * latency instead, and drags the transport cursor there so the two clocks
   * stay in agreement rather than quietly diverging.
   */
  const [latency, setLatency] = useState<number | null>(null);
  const t = useStore((s) => s.t);
  const setCursor = useStore((s) => s.setCursor);
  const clock = useStore((s) => s.epochsClock);
  const linked = epochAt(clock, t);

  const { data, state, error } = usePanelData<EvokedResult | null>(
    () => (hasEvoked ? api.evoked(id!) : Promise.resolve(null)),
    [id, sigKey, hasEvoked],
    { enabled: !!id && hasEvoked, label: "Evoked" },
  );

  const series = useMemo<Series[]>(() => {
    if (!data) return [];
    const p = paint(themeTick);
    const out: Series[] = data.channels.map((ch) => ({
      id: ch, x: data.times, y: data.data[ch], color: "rgba(120,120,132,0.30)", width: 0.6,
    }));
    if (focusChannel && data.data[focusChannel]) {
      out.push({ id: focusChannel, x: data.times, y: data.data[focusChannel], color: p.accent, width: 1.5 });
    }
    out.push({ id: "GFP", x: data.times, y: data.gfp, color: p.text, width: 1.7 });
    return out;
  }, [data, themeTick, focusChannel]);

  const average = async () => {
    setBusy(true);
    try { await runOp("average_epochs", { condition: null }, "Averaged to evoked"); }
    catch { /* runOp toasted */ } finally { setBusy(false); }
  };

  if (!session) return <Panel paneId="evoked" title="Evoked"><div /></Panel>;

  if (!hasEvoked) {
    return (
      <Panel paneId="evoked" title="Evoked">
        <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
          <Activity size={26} className="text-fg-faint" />
          <div className="text-base text-fg">Average the trials</div>
          <div className="max-w-md text-xs leading-relaxed text-fg-dim">
            {hasEpochs
              ? "Collapse the epochs into one waveform per channel, with global field power and a topography at any latency."
              : "Create epochs first. An average needs trials to average."}
          </div>
          {hasEpochs && (
            <button
              onClick={average}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-xs border border-accent/40 bg-accent/12 px-3 py-1.5
                         text-sm font-medium text-accent hover:bg-accent/20 disabled:opacity-50"
            >
              {busy && <Loader2 size={12} className="animate-spin" />}
              {busy ? "Averaging…" : "Average to evoked"}
            </button>
          )}
        </div>
      </Panel>
    );
  }

  // Preference order: what the user pinned, then where the transport cursor is
  // if it lands in a trial at all, then the peak. The peak is the fallback, not
  // the default: a pane that ignores the cursor is the thing being fixed here.
  const at = latency ?? linked?.latency ?? data?.peak_time ?? 0;
  return (
    <Panel
      paneId="evoked"
      container="evoked"
      title={data ? `Evoked · ${data.nave} trials averaged, from Epochs` : "Evoked"}
      state={state}
      error={error}
      right={data && (
        <span className="mono text-2xs text-fg-faint">
          {latency !== null && (
            <button onClick={() => setLatency(null)}
              className="mr-2 rounded-xs border border-seam px-1 py-px text-fg-dim hover:text-fg">
              follow cursor
            </button>
          )}
          peak {data.peak_channel} at {(data.peak_time * 1000).toFixed(0)} ms
        </span>
      )}
    >
      <div className="flex h-full min-h-0">
        <div className="flex min-w-0 flex-[3] flex-col">
          <div className="shrink-0 border-b border-seam px-2 py-1 text-2xs text-fg-faint">
            {linked
              ? `butterfly and global field power · following the cursor, trial ${linked.index + 1}`
              : "butterfly and global field power · click to move the latency"}
          </div>
          <div className="min-h-0 flex-1">
            {data && (
              <LinePlot
                series={series}
                xDomain={[data.times[0], data.times[data.times.length - 1]]}
                xLabel="s"
                yLabel="µV"
                cursorX={at}
                onClickX={(x) => {
                  setLatency(x);
                  // ...and take the recording cursor with it, so the waveform
                  // under the transport is showing the moment this map is of.
                  const rt = linked ? recordingTimeOf(clock, linked.index, x) : null;
                  if (rt !== null) setCursor(rt);
                }}
              />
            )}
          </div>
        </div>
        <div className="flex w-[38%] min-w-0 shrink-0 flex-col border-l border-seam">
          <div className="mono shrink-0 border-b border-seam px-2 py-1 text-2xs text-fg-faint">
            scalp at {(at * 1000).toFixed(0)} ms
          </div>
          <div className="min-h-0 flex-1">
            {/* the evoked topography is not on the precomputed grid, so it is
                rendered on demand and debounced a little harder */}
            <RenderedImage
              spec={{ view: "topomap", source: "evoked", t: Math.round(at * 1000) / 1000,
                      width: FRAME_SIZE, height: FRAME_SIZE }}
              deps={[sigKey, Math.round(at * 1000)]}
              alt="evoked scalp topography"
              debounceMs={180}
            />
          </div>
        </div>
      </div>
    </Panel>
  );
}
