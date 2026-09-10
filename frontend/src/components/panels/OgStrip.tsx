import { usePanelData } from "./usePanelData";
import { useCanvas } from "../../lib/plot/useCanvas";
import { linScale } from "../../lib/plot/scales";
import { paint } from "../../lib/plot/paint";
import { api, type OverviewResult } from "../../api/client";
import { useStore } from "../../store/store";

/**
 * The "og strip": the whole original recording condensed to a bare silhouette,
 * sitting directly under the transport. Deliberately chrome-less: no header, no
 * border, no cursor rule, no channel gutter. Just the shape of the recording.
 *
 * It replaces the transport's scrub bar: the current window is a shaded region
 * you can click or drag, and because it reads `source: "original"` the shape
 * stays put while the working copy is filtered, re-referenced or ICA-cleaned.
 */
export function OgStrip() {
  const session = useStore((s) => s.session);
  const windowStart = useStore((s) => s.windowStart);
  const windowDuration = useStore((s) => s.windowDuration);
  const setWindow = useStore((s) => s.setWindow);
  const setCursor = useStore((s) => s.setCursor);
  const themeTick = useStore((s) => s.themeTick);

  const id = session?.session_id;
  // no signature key: the pristine envelope never changes for a session
  const { data } = usePanelData<OverviewResult>(
    () => api.overview(id!, 1400, "original"),
    [id],
    { enabled: !!id, label: "Original" },
  );

  const dur = data?.duration ?? session?.duration_seconds ?? 1;

  const canvasRef = useCanvas(({ ctx, width, height }) => {
    if (!data) return;
    const p = paint(themeTick);
    const xs = linScale([0, dur], [0, width]);
    const maxR = Math.max(...data.rms, 1e-6);
    // mirrored envelope around the mid-line: reads as a waveform, not a chart
    const half = (height - 2) / 2;
    const mid = height / 2;
    const amp = (v: number) => (v / maxR) * half;

    ctx.beginPath();
    for (let i = 0; i < data.t.length; i++) ctx.lineTo(xs(data.t[i]), mid - amp(data.rms[i]));
    for (let i = data.t.length - 1; i >= 0; i--) ctx.lineTo(xs(data.t[i]), mid + amp(data.rms[i]));
    ctx.closePath();
    ctx.fillStyle = p.textFaint;
    ctx.globalAlpha = 0.55;
    ctx.fill();
    ctx.globalAlpha = 1;

    // the window, as a region: not a rule
    const wx0 = xs(windowStart);
    const wx1 = Math.max(xs(windowStart + windowDuration), wx0 + 2);
    ctx.fillStyle = p.accent;
    ctx.globalAlpha = 0.16;
    ctx.fillRect(wx0, 0, wx1 - wx0, height);
    ctx.globalAlpha = 1;
    ctx.fillStyle = p.accent;
    ctx.fillRect(wx0, 0, wx1 - wx0, 1.5);
    ctx.fillRect(wx0, height - 1.5, wx1 - wx0, 1.5);
  }, [themeTick, data, dur, windowStart, windowDuration]);

  const seek = (clientX: number, el: HTMLElement, cursor: boolean) => {
    const rect = el.getBoundingClientRect();
    const time = ((clientX - rect.left) / rect.width) * dur;
    if (cursor) setCursor(time);
    else setWindow(time - windowDuration / 2);
  };

  return (
    <canvas
      ref={canvasRef}
      className="block h-full w-full cursor-pointer touch-none"
      title="original recording · click or drag to move the window · shift = move the cursor"
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        seek(e.clientX, e.currentTarget, e.shiftKey);
      }}
      onPointerMove={(e) => e.buttons === 1 && seek(e.clientX, e.currentTarget, e.shiftKey)}
    />
  );
}
