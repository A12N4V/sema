import { useRef } from "react";

export function Split({ axis, onDelta }: { axis: "x" | "y"; onDelta: (px: number) => void }) {
  const last = useRef(0);
  return (
    <div
      className="tile-split"
      data-axis={axis}
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        last.current = axis === "x" ? e.clientX : e.clientY;
      }}
      onPointerMove={(e) => {
        if (!(e.target as HTMLElement).hasPointerCapture(e.pointerId)) return;
        const now = axis === "x" ? e.clientX : e.clientY;
        onDelta(now - last.current);
        last.current = now;
      }}
      onPointerUp={(e) => (e.target as HTMLElement).releasePointerCapture(e.pointerId)}
    />
  );
}

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
