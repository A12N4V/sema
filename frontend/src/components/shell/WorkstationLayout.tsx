import { useState } from "react";
import { Waveform } from "../panels/Waveform";
import { PSD } from "../panels/PSD";
import { BandHeatmap } from "../panels/BandHeatmap";
import { TopographyCard } from "../cards/TopographyCard";
import { Field3DCard } from "../cards/Field3DCard";
import { Transport } from "./Transport";

/**
 * The fixed "workstation" layout for the Raw container:
 *   LEFT  — waveform workflow (70) · original recording (20) · transport (~10)
 *   RIGHT — top half: complex visuals (topography + 3D field)
 *           bottom half: graphs (spectrum + band power)
 * A draggable seam sets the left/right split.
 */
export function WorkstationLayout() {
  const [split, setSplit] = useState(0.56); // left column fraction

  return (
    <div className="flex h-full min-h-0 w-full">
      {/* LEFT — waveform workflow */}
      <div className="flex min-w-0 flex-col" style={{ flexBasis: `${split * 100}%`, flexGrow: 0, flexShrink: 0 }}>
        <div className="min-h-0 overflow-hidden border-b border-seam" style={{ flex: "70 1 0" }}>
          <Waveform />
        </div>
        <div className="min-h-0 overflow-hidden border-b border-seam" style={{ flex: "20 1 0" }}>
          <Waveform source="original" compact />
        </div>
        <Transport />
      </div>

      {/* draggable seam */}
      <div
        className="tile-split shrink-0"
        data-axis="x"
        onPointerDown={(e) => {
          const startX = e.clientX;
          const startSplit = split;
          const w = (e.currentTarget.parentElement as HTMLElement).clientWidth;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          const move = (ev: PointerEvent) => {
            setSplit(Math.max(0.32, Math.min(0.78, startSplit + (ev.clientX - startX) / w)));
          };
          const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
        }}
      />

      {/* RIGHT — visuals over graphs */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 border-b border-seam">
          <div className="min-w-0 flex-1 border-r border-seam"><TopographyCard /></div>
          <div className="min-w-0 flex-1"><Field3DCard /></div>
        </div>
        <div className="flex min-h-0 flex-1">
          <div className="min-w-0 flex-1 border-r border-seam"><PSD /></div>
          <div className="min-w-0 flex-1"><BandHeatmap /></div>
        </div>
      </div>
    </div>
  );
}
