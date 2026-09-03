import { useMemo, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { Panel } from "./Panel";
import { usePanelData } from "./usePanelData";
import { useCanvas } from "../../lib/plot/useCanvas";
import { linScale } from "../../lib/plot/scales";
import { paint } from "../../lib/plot/paint";
import { api, type Wire } from "../../api/client";
import { useStore } from "../../store/store";
import { useSignatureKey } from "../../store/useSignatureKey";

const GUTTER = 52;

export function Waveform({ source = "current", compact = false }: { source?: "current" | "original"; compact?: boolean } = {}) {
  const session = useStore((s) => s.session);
  const selected = useStore((s) => s.selectedChannels);
  const windowStart = useStore((s) => s.windowStart);
  const windowDuration = useStore((s) => s.windowDuration);
  const t = useStore((s) => s.t);
  const setCursor = useStore((s) => s.setCursor);
  const setWindow = useStore((s) => s.setWindow);
  const focusChannel = useStore((s) => s.focusChannel);
  const setFocusChannel = useStore((s) => s.setFocusChannel);
  const themeTick = useStore((s) => s.themeTick);
  const [gain, setGain] = useState(1);

  const id = session?.session_id;
  const isOriginal = source === "original";
  const chans = selected.length ? selected : session?.channel_names.slice(0, 16) ?? [];
  const sigKey = useSignatureKey();

  const { data, state, error } = usePanelData<Wire>(
    (signal) => api.window(id!, { start: windowStart, duration: windowDuration, channels: chans, max_points: compact ? 1200 : 2400, source }).then((r) => {
      if (signal.aborted) throw new DOMException("aborted", "AbortError");
      return r;
    }),
    [id, windowStart, windowDuration, chans.join(","), source, isOriginal ? "" : sigKey],
    { enabled: !!id, label: isOriginal ? "Original" : "Waveform" },
  );

  const spread = useMemo(() => {
    if (!data) return 40;
    const vals: number[] = [];
    for (const ch of data.channels) for (const v of data.data[ch] ?? []) vals.push(Math.abs(v));
    vals.sort((a, b) => a - b);
    const p90 = vals[Math.floor(vals.length * 0.9)] || 40;
    return p90 * 2.2;
  }, [data]);

  const bads = new Set(session?.bads ?? []);

  const canvasRef = useCanvas(({ ctx, width, height }) => {
    if (!data) return;
    const p = paint(themeTick);
    const chList = data.channels;
    const n = chList.length;
    const t0 = windowStart;
    const t1 = windowStart + windowDuration;
    const xs = linScale([t0, t1], [GUTTER, width]);
    const rowH = height / Math.max(n, 1);
    const perDiv = (spread / gain);

    // row separators + labels
    ctx.font = "10px ui-monospace, monospace";
    ctx.textBaseline = "middle";
    for (let i = 0; i < n; i++) {
      const ch = chList[i];
      const yMid = (i + 0.5) * rowH;
      const isBad = bads.has(ch);
      const isFocus = ch === focusChannel;
      if (isFocus) {
        ctx.fillStyle = p.accentSoft;
        ctx.fillRect(0, i * rowH, width, rowH);
      }
      ctx.strokeStyle = p.grid;
      ctx.beginPath();
      ctx.moveTo(GUTTER, i * rowH + 0.5);
      ctx.lineTo(width, i * rowH + 0.5);
      ctx.stroke();

      ctx.fillStyle = isBad ? p.alert : isFocus ? p.accent : p.textDim;
      ctx.textAlign = "left";
      ctx.fillText(ch, 6, yMid);

      // trace
      const ys = linScale([-perDiv, perDiv], [yMid + rowH * 0.46, yMid - rowH * 0.46]);
      ctx.beginPath();
      ctx.strokeStyle = isBad ? p.alert : isFocus ? p.accent : p.trace;
      ctx.globalAlpha = isBad ? 0.5 : 1;
      ctx.lineWidth = isFocus ? 1.3 : 0.9;
      const xarr = data.time;
      const yarr = data.data[ch];
      if (!yarr) continue;
      for (let k = 0; k < xarr.length; k++) {
        const px = xs(xarr[k]);
        const py = ys(Math.max(-perDiv * 1.5, Math.min(perDiv * 1.5, yarr[k])));
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // gutter divider
    ctx.strokeStyle = p.seam;
    ctx.beginPath();
    ctx.moveTo(GUTTER + 0.5, 0);
    ctx.lineTo(GUTTER + 0.5, height);
    ctx.stroke();

    // shared cursor
    if (t >= t0 && t <= t1) {
      const px = Math.round(xs(t)) + 0.5;
      ctx.strokeStyle = p.cursor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, height);
      ctx.stroke();
      ctx.fillStyle = p.cursor;
      ctx.fillRect(px - 0.5, 0, 1, 4);
    }

    // annotations in window
    for (const a of session?.annotations ?? []) {
      if (a.onset >= t0 && a.onset <= t1) {
        const px = xs(a.onset);
        ctx.strokeStyle = p.warn;
        ctx.globalAlpha = 0.5;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(px, 0);
        ctx.lineTo(px, height);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
    }

    // scale bar
    ctx.fillStyle = p.textFaint;
    ctx.font = "9px ui-monospace, monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText(`${(perDiv).toFixed(0)} µV/div · ${windowDuration.toFixed(1)}s`, width - 6, height - 4);
  }, [themeTick, data, spread, gain, t, windowStart, windowDuration, focusChannel, session?.bads?.join(","), session?.annotations?.length]);

  const pxToTime = (clientX: number, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    const x = clientX - rect.left;
    if (x < GUTTER) return null;
    return windowStart + ((x - GUTTER) / (rect.width - GUTTER)) * windowDuration;
  };
  const rowToChannel = (clientY: number, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    const list = data?.channels ?? [];
    const i = Math.floor(((clientY - rect.top) / rect.height) * list.length);
    return list[i];
  };

  return (
    <Panel
      title={isOriginal ? "Original recording" : "Waveform"} fkey="F1" state={state} error={error}
      emptyHint={session ? "Loading window…" : "No session"}
      right={
        isOriginal ? (
          <span className="text-2xs text-fg-faint">pristine · read-only</span>
        ) : (
          <div className="flex items-center gap-1">
            <button className="rounded px-1 text-fg-dim hover:text-fg" onClick={() => setGain((g) => g * 1.3)}><Plus size={11} /></button>
            <button className="rounded px-1 text-fg-dim hover:text-fg" onClick={() => setGain((g) => g / 1.3)}><Minus size={11} /></button>
          </div>
        )
      }
    >
      <canvas
        ref={canvasRef}
        className="block h-full w-full cursor-crosshair"
        onMouseMove={(e) => {
          if (e.buttons === 1) {
            const tt = pxToTime(e.clientX, e.currentTarget);
            if (tt != null) setCursor(tt);
          }
        }}
        onClick={(e) => {
          if (e.clientX - e.currentTarget.getBoundingClientRect().left < GUTTER) {
            const ch = rowToChannel(e.clientY, e.currentTarget);
            if (ch) setFocusChannel(focusChannel === ch ? null : ch);
            return;
          }
          const tt = pxToTime(e.clientX, e.currentTarget);
          if (tt != null) setCursor(tt);
        }}
        onWheel={(e) => {
          if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) return;
          setWindow(windowStart + (e.deltaX / 200) * windowDuration);
        }}
      />
    </Panel>
  );
}
