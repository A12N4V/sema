import { useState } from "react";
import { ChannelsTable } from "../panels/ChannelsTable";
import { Annotations } from "../panels/Annotations";
import { Waveform } from "../panels/Waveform";
import { Maximized } from "./Maximized";
import { PANE_LABEL } from "../../lib/paneLabels";
import { useStore } from "../../store/store";
import { useMediaQuery } from "../../lib/useMediaQuery";

/**
 * CHANNELS AND ANNOTATIONS: the recording's metadata, in one place.
 *
 * They share a workspace because they are edited together and for the same
 * reason. You scan the table, find a flat electrode, mark it bad; you scrub the
 * trace, find a swallow artifact, mark the span. Both are the answer to "what in
 * this recording should the maths ignore", and both were previously impossible.
 *
 * The trace sits alongside rather than on another page, because a channel is
 * marked bad on the evidence of its trace and a span is marked on the evidence
 * of the signal under it.
 */
const PANES = {
  channels: () => <ChannelsTable />,
  annotations: () => <Annotations />,
  waveform: () => <Waveform />,
};

export function ChannelsPage() {
  const maximized = useStore((s) => s.maximized);
  const isDesktop = useMediaQuery("(min-width: 900px)");
  const [split, setSplit] = useState(0.52);

  if (maximized && maximized in PANES) {
    return (
      <Maximized title={PANE_LABEL[maximized] ?? maximized}>
        {PANES[maximized as keyof typeof PANES]()}
      </Maximized>
    );
  }

  if (!isDesktop) {
    return (
      <div className="flex h-full min-h-0 w-full flex-col overflow-y-auto">
        <div className="h-[55vh] min-h-[320px] shrink-0 border-b border-seam"><ChannelsTable /></div>
        <div className="h-[45vh] min-h-[280px] shrink-0 border-b border-seam"><Annotations /></div>
        <div className="h-[45vh] min-h-[280px] shrink-0"><Waveform /></div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full">
      <div className="min-w-0" style={{ flexBasis: `${split * 100}%`, flexGrow: 0, flexShrink: 0 }}>
        <ChannelsTable />
      </div>
      <div
        className="tile-split shrink-0"
        data-axis="x"
        role="separator"
        aria-orientation="vertical"
        onPointerDown={(e) => {
          const startX = e.clientX;
          const start = split;
          const w = (e.currentTarget.parentElement as HTMLElement).clientWidth;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          const move = (ev: PointerEvent) =>
            setSplit(Math.max(0.28, Math.min(0.72, start + (ev.clientX - startX) / w)));
          const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
        }}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-[2] border-b border-seam"><Waveform /></div>
        <div className="min-h-0 flex-[3]"><Annotations /></div>
      </div>
    </div>
  );
}
