import { Play, Pause, ChevronsLeft, ChevronsRight } from "lucide-react";
import { OgStrip } from "../panels/OgStrip";
import { fmtTime } from "../../lib/plot/scales";
import { useStore } from "../../store/store";
import { Segmented } from "../ui/primitives";
import type { Page } from "../../lib/router";

/**
 * The recording's clock, and it belongs to the *session*, not to one pane.
 *
 * It used to live inside the Raw page, which meant that stepping to ICA or
 * Source made the transport, the cursor readout and the recording's silhouette
 * all disappear: and with them any sign that those containers are views of the
 * same 3 minutes of the same recording. They are all cursor-linked: the ICA
 * activation trace, the source brain and the topography all answer to `t`. So
 * the clock sits under the viewport on every container, and the og strip keeps
 * the whole recording in view no matter which derived object you are inspecting.
 *
 * `context` names, in one line, what the viewport is showing and where it came
 * from: the second half of "are we looking at the same data?".
 */
const CONTEXT: Record<Page, (n: number) => string> = {
  signal: (n) => `Raw · ${n} channels`,
  channels: (n) => `Raw · ${n} channels and their annotations`,
  ica: () => "ICA · components of Raw",
  source: () => "Source · inverse of Raw",
  // epoch-relative containers never mount this bar, but the map stays total so
  // adding a container is a compile error here rather than a blank readout
  epochs: () => "Epochs · trials cut from Raw",
  evoked: () => "Evoked · average of Epochs",
  tfr: () => "Time-frequency · power over Epochs",
  pipeline: () => "Pipeline · provenance of Raw",
};

export function TimeBar({ page }: { page: Page }) {
  const session = useStore((s) => s.session);
  const playing = useStore((s) => s.playing);
  const setPlaying = useStore((s) => s.setPlaying);
  const pageWindow = useStore((s) => s.pageWindow);
  const t = useStore((s) => s.t);
  const speed = useStore((s) => s.speed);
  const windowDuration = useStore((s) => s.windowDuration);
  const setSpeed = useStore((s) => s.setSpeed);
  if (!session) return null;

  return (
    <div className="shrink-0 border-t border-seam bg-bg">
      <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-fg-dim">
        <button
          className="rounded-xs border border-seam p-0.5 transition-colors hover:border-seam-bright hover:text-fg"
          title="Previous window  (←)"
          aria-label="Previous window"
          onClick={() => pageWindow(-1)}
        >
          <ChevronsLeft size={12} />
        </button>
        <button
          className="rounded-xs border border-seam p-0.5 transition-colors hover:border-seam-bright hover:text-fg"
          title={playing ? "Pause  (space)" : "Play  (space)"}
          aria-label={playing ? "Pause" : "Play"}
          onClick={() => setPlaying(!playing)}
        >
          {playing ? <Pause size={12} /> : <Play size={12} />}
        </button>
        <button
          className="rounded-xs border border-seam p-0.5 transition-colors hover:border-seam-bright hover:text-fg"
          title="Next window  (→)"
          aria-label="Next window"
          onClick={() => pageWindow(1)}
        >
          <ChevronsRight size={12} />
        </button>

        <span className="mono shrink-0 tabular-nums text-fg-faint">
          {fmtTime(t)} / {fmtTime(session.duration_seconds)}
        </span>

        <Segmented
          size="xs"
          value={String(speed)}
          onChange={(v) => setSpeed(Number(v))}
          options={[{ value: "1", label: "1×" }, { value: "2", label: "2×" }, { value: "4", label: "4×" }]}
        />

        {/* what the viewport above is, and what it derives from */}
        <span className="mono ml-auto truncate text-2xs text-fg-faint">
          <span className="max-[860px]:hidden">{windowDuration.toFixed(0)}s window · </span>
          {CONTEXT[page](session.n_channels)}
        </span>
      </div>
      <div className="h-[42px] border-t border-seam">
        <OgStrip />
      </div>
    </div>
  );
}
