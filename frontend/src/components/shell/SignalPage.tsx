import { useState } from "react";
import { Waveform } from "../panels/Waveform";
import { VisualsCard } from "../cards/VisualsCard";
import { Maximized } from "./Maximized";
import { PANE_LABEL } from "../../lib/paneLabels";
import { useStore } from "../../store/store";
import { useMediaQuery } from "../../lib/useMediaQuery";

/**
 * RAW: the continuous recording. One time cursor drives every pane, and the
 * clock itself lives in the shell's TimeBar so it survives a container switch.
 *
 *   left   the waveform
 *   right  two visualization panes, stacked: the map and the number that
 *          explains it, at the same time. One pane in that column left a column
 *          of dead space beside a 280px figure; two make the column earn its
 *          width, and each keeps its own tab so the pairing is the user's
 *          (topography + spectrum by default).
 *
 * Both splits drag. On a phone the order flips: the visualization goes on top,
 * because on a 375px screen the thing you came to look at should not be below
 * the fold, and the waveform is the pane you scroll *to*.
 */
const PANES = {
  waveform: () => <Waveform />,
  "visuals-a": () => <VisualsCard paneId="visuals-a" initialTab="topo" title="Visualization A" />,
  "visuals-b": () => <VisualsCard paneId="visuals-b" initialTab="spectrum" title="Visualization B" />,
};

export function SignalPage() {
  const [split, setSplit] = useState(0.56);
  const [vSplit, setVSplit] = useState(0.5);
  const maximized = useStore((s) => s.maximized);
  const isDesktop = useMediaQuery("(min-width: 900px)");

  if (maximized && maximized in PANES) {
    return <Maximized title={PANE_LABEL[maximized] ?? maximized}>{PANES[maximized as keyof typeof PANES]()}</Maximized>;
  }

  if (!isDesktop) {
    return (
      <div className="flex h-full min-h-0 w-full flex-col overflow-y-auto">
        <div className="h-[46vh] min-h-[300px] shrink-0 border-b border-seam">
          <VisualsCard paneId="visuals-a" initialTab="topo" title="Visualization" />
        </div>
        <div className="h-[52vh] min-h-[300px] shrink-0">
          <Waveform />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full">
      {/* LEFT, the recording itself */}
      <div
        className="flex min-w-0 flex-col"
        style={{ flexBasis: `${split * 100}%`, flexGrow: 0, flexShrink: 0 }}
      >
        <Waveform />
      </div>

      <Splitter
        axis="x"
        onDrag={(dx, w, start) => setSplit(Math.max(0.3, Math.min(0.76, start + dx / w)))}
        value={split}
      />

      {/* RIGHT, two looks at the window under the cursor, at once */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="min-h-0 overflow-hidden" style={{ flexBasis: `${vSplit * 100}%`, flexGrow: 0, flexShrink: 0 }}>
          <VisualsCard paneId="visuals-a" initialTab="topo" title="Visualization A" />
        </div>
        <Splitter
          axis="y"
          onDrag={(dy, h, start) => setVSplit(Math.max(0.22, Math.min(0.78, start + dy / h)))}
          value={vSplit}
        />
        <div className="min-h-0 flex-1 overflow-hidden">
          <VisualsCard paneId="visuals-b" initialTab="spectrum" title="Visualization B" />
        </div>
      </div>
    </div>
  );
}

/** A draggable seam. `onDrag` gets the delta, the container size, and the value at grab. */
function Splitter({
  axis, value, onDrag,
}: {
  axis: "x" | "y";
  value: number;
  onDrag: (delta: number, size: number, start: number) => void;
}) {
  return (
    <div
      className="tile-split shrink-0"
      data-axis={axis}
      role="separator"
      aria-orientation={axis === "x" ? "vertical" : "horizontal"}
      onPointerDown={(e) => {
        const start0 = axis === "x" ? e.clientX : e.clientY;
        const startValue = value;
        const parent = e.currentTarget.parentElement as HTMLElement;
        const size = axis === "x" ? parent.clientWidth : parent.clientHeight;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        const move = (ev: PointerEvent) =>
          onDrag((axis === "x" ? ev.clientX : ev.clientY) - start0, size, startValue);
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      }}
    />
  );
}
