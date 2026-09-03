import { Panel } from "./Panel";
import { usePanelData } from "./usePanelData";
import { useCanvas } from "../../lib/plot/useCanvas";
import { linScale, fmtTime } from "../../lib/plot/scales";
import { paint } from "../../lib/plot/paint";
import { api, type OverviewResult } from "../../api/client";
import { useStore } from "../../store/store";
import { useSignatureKey } from "../../store/useSignatureKey";

export function Minimap() {
  const session = useStore((s) => s.session);
  const windowStart = useStore((s) => s.windowStart);
  const windowDuration = useStore((s) => s.windowDuration);
  const t = useStore((s) => s.t);
  const setWindow = useStore((s) => s.setWindow);
  const setCursor = useStore((s) => s.setCursor);
  const themeTick = useStore((s) => s.themeTick);

  const id = session?.session_id;
  const sigKey = useSignatureKey();
  const { data, state, error } = usePanelData<OverviewResult>(
    () => api.overview(id!, 1400),
    [id, sigKey],
    { enabled: !!id, label: "Minimap" },
  );

  const dur = data?.duration ?? session?.duration_seconds ?? 1;

  const canvasRef = useCanvas(({ ctx, width, height }) => {
    if (!data) return;
    const p = paint(themeTick);
    const xs = linScale([0, dur], [0, width]);
    const maxR = Math.max(...data.rms, 1e-6);
    const ys = linScale([0, maxR], [height - 2, 4]);

    // envelope
    ctx.beginPath();
    ctx.moveTo(0, height);
    for (let i = 0; i < data.t.length; i++) ctx.lineTo(xs(data.t[i]), ys(data.rms[i]));
    ctx.lineTo(width, height);
    ctx.closePath();
    ctx.fillStyle = p.accentSoft;
    ctx.fill();
    ctx.strokeStyle = p.accent;
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < data.t.length; i++) {
      const px = xs(data.t[i]);
      const py = ys(data.rms[i]);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    // window box
    const wx0 = xs(windowStart);
    const wx1 = xs(windowStart + windowDuration);
    ctx.fillStyle = p.gridStrong;
    ctx.globalAlpha = 0.35;
    ctx.fillRect(wx0, 0, wx1 - wx0, height);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = p.textDim;
    ctx.strokeRect(wx0 + 0.5, 0.5, wx1 - wx0 - 1, height - 1);

    // cursor
    const cx = Math.round(xs(t)) + 0.5;
    ctx.strokeStyle = p.cursor;
    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, height);
    ctx.stroke();
  }, [themeTick, data, dur, windowStart, windowDuration, t]);

  const seek = (clientX: number, el: HTMLElement, mode: "window" | "cursor") => {
    const rect = el.getBoundingClientRect();
    const time = ((clientX - rect.left) / rect.width) * dur;
    if (mode === "cursor") setCursor(time);
    else setWindow(time - windowDuration / 2);
  };

  return (
    <Panel title="Minimap" fkey="F7" state={state} error={error} emptyHint="Loading overview…"
      right={<span className="mono text-2xs text-fg-faint">{fmtTime(windowStart)} · {fmtTime(dur)}</span>}
    >
      <canvas
        ref={canvasRef}
        className="block h-full w-full cursor-pointer"
        onMouseDown={(e) => seek(e.clientX, e.currentTarget, e.shiftKey ? "cursor" : "window")}
        onMouseMove={(e) => { if (e.buttons === 1) seek(e.clientX, e.currentTarget, e.shiftKey ? "cursor" : "window"); }}
      />
    </Panel>
  );
}
