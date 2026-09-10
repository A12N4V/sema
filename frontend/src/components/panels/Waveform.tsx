import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Minus, Plus } from "lucide-react";
import { Panel } from "./Panel";
import { usePanelData } from "./usePanelData";
import { useCanvas } from "../../lib/plot/useCanvas";
import { linScale, ticks } from "../../lib/plot/scales";
import { paint } from "../../lib/plot/paint";
import { api, type Wire } from "../../api/client";
import { useStore } from "../../store/store";
import { useSignatureKey } from "../../store/useSignatureKey";

const GUTTER = 56;
const AXIS = 16;          // room under the traces for the time axis
const ROWS_PER_PAGE = 16; // what fits legibly in a pane before rows become slivers

/**
 * The trace view. Three things here are not decoration and were missing:
 *
 *  - **the scale**. µV per division and the window length, stated. An EEG
 *    reader works in µV/div; a gain control with no number is unusable.
 *  - **the time axis**. Gridlines with no numbers tell you nothing about where
 *    you are inside the window.
 *  - **every channel, reachable**. The view used to draw the first sixteen
 *    channels and give no sign that a 32 channel montage had another sixteen.
 *    Silently hiding half a montage is not safe to review with, so the header
 *    states the range and pages through the rest.
 *
 * Annotations are drawn as spans, not ticks, and BAD_* segments are drawn in the
 * alert colour because that is the set MNE will exclude from later maths.
 */
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
  const [page, setPage] = useState(0);

  const id = session?.session_id;
  const isOriginal = source === "original";
  const all = selected.length ? selected : session?.channel_names ?? [];
  const pageSize = compact ? 8 : ROWS_PER_PAGE;
  const pages = Math.max(1, Math.ceil(all.length / pageSize));
  const from = Math.min(page, pages - 1) * pageSize;
  const chans = all.slice(from, from + pageSize);
  const sigKey = useSignatureKey();

  // a shorter channel list must not leave the view paged past the end
  useEffect(() => { if (page >= pages) setPage(0); }, [pages, page]);

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
  const perDiv = spread / gain;

  const canvasRef = useCanvas(({ ctx, width, height }) => {
    if (!data) return;
    const p = paint(themeTick);
    const chList = data.channels;
    const n = chList.length;
    const t0 = windowStart;
    const t1 = windowStart + windowDuration;
    const xs = linScale([t0, t1], [GUTTER, width]);
    const plotH = Math.max(20, height - AXIS);
    const rowH = plotH / Math.max(n, 1);

    // annotation spans, painted first so traces sit on top of them
    for (const a of session?.annotations ?? []) {
      const end = a.onset + (a.duration || 0);
      if (end < t0 || a.onset > t1) continue;
      const isBad = a.description.toUpperCase().startsWith("BAD");
      const x0 = xs(Math.max(a.onset, t0));
      const x1 = Math.max(xs(Math.min(end, t1)), x0 + 1.5);
      ctx.fillStyle = isBad ? p.alert : p.warn;
      ctx.globalAlpha = a.duration ? 0.13 : 0.5;
      ctx.fillRect(x0, 0, x1 - x0, plotH);
      ctx.globalAlpha = 1;
      ctx.fillStyle = isBad ? p.alert : p.warn;
      ctx.fillRect(x0, 0, Math.max(1, Math.min(x1 - x0, 1.5)), plotH);
    }

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
      if (isBad) {
        // struck through, so "bad" reads without relying on colour alone
        const w = ctx.measureText(ch).width;
        ctx.strokeStyle = p.alert;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(6, yMid + 0.5);
        ctx.lineTo(6 + w, yMid + 0.5);
        ctx.stroke();
      }

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

    // time axis: absolute seconds, because the cursor readout is absolute too
    ctx.strokeStyle = p.seam;
    ctx.beginPath();
    ctx.moveTo(GUTTER, plotH + 0.5);
    ctx.lineTo(width, plotH + 0.5);
    ctx.stroke();
    ctx.font = "9px ui-monospace, monospace";
    ctx.fillStyle = p.textFaint;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const decimals = windowDuration <= 2 ? 2 : windowDuration <= 20 ? 1 : 0;
    for (const v of ticks(t0, t1, 6)) {
      if (v < t0 || v > t1) continue;
      const px = Math.round(xs(v)) + 0.5;
      ctx.strokeStyle = p.grid;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, plotH);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(px, plotH);
      ctx.lineTo(px, plotH + 3);
      ctx.strokeStyle = p.seam;
      ctx.stroke();
      // A centred label on the first tick overhangs into the gutter and lands
      // on top of the "46 µV/div" readout; on the last it runs off the right
      // edge. Anchor the two end labels inward and leave the rest centred.
      const label = v.toFixed(decimals);
      const w = ctx.measureText(label).width;
      let lx = px;
      if (px - w / 2 < GUTTER + 2) lx = GUTTER + 2 + w / 2;
      else if (px + w / 2 > width - 2) lx = width - 2 - w / 2;
      ctx.fillText(label, lx, plotH + 4);
    }

    ctx.strokeStyle = p.seam;
    ctx.beginPath();
    ctx.moveTo(GUTTER + 0.5, 0);
    ctx.lineTo(GUTTER + 0.5, plotH);
    ctx.stroke();

    if (t >= t0 && t <= t1) {
      const px = Math.round(xs(t)) + 0.5;
      ctx.strokeStyle = p.cursor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, plotH);
      ctx.stroke();
      ctx.fillStyle = p.cursor;
      ctx.fillRect(px - 0.5, 0, 1, 4);
    }

    // the scale, stated. It lives in the gutter under the channel names, which
    // is otherwise empty: on the right it sat on top of the last time tick.
    ctx.fillStyle = p.textFaint;
    ctx.font = "9px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(`${perDiv.toFixed(0)} µV/div`, 4, plotH + 4);
  }, [themeTick, data, spread, gain, t, windowStart, windowDuration, focusChannel,
      session?.bads?.join(","), JSON.stringify(session?.annotations ?? [])]);

  const pxToTime = (clientX: number, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    const x = clientX - rect.left;
    if (x < GUTTER) return null;
    return windowStart + ((x - GUTTER) / (rect.width - GUTTER)) * windowDuration;
  };
  const rowToChannel = (clientY: number, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    const list = data?.channels ?? [];
    const plotH = Math.max(20, rect.height - AXIS);
    const i = Math.floor(((clientY - rect.top) / plotH) * list.length);
    return list[i];
  };

  const pageBtn = "rounded-xs border border-seam px-1 text-fg-dim transition-colors disabled:opacity-30 hover:border-seam-bright hover:text-fg";

  return (
    <Panel paneId="waveform"
      title={isOriginal ? "Original recording" : "Waveform"} state={state} error={error}
      emptyHint={session ? "Loading window…" : "No session"}
      right={
        isOriginal ? (
          <span className="text-2xs text-fg-faint">pristine · read-only</span>
        ) : (
          <div className="flex items-center gap-1.5">
            {/* the count is the point: never leave hidden channels unannounced */}
            <span className="mono text-2xs tabular-nums text-fg-faint"
                  title={`${all.length} channels selected, ${pageSize} shown at a time`}>
              {all.length ? `${from + 1}-${Math.min(from + pageSize, all.length)} of ${all.length}` : "no channels"}
            </span>
            {pages > 1 && (
              <>
                <button className={pageBtn} disabled={page === 0}
                        title="Earlier channels" aria-label="Previous channels"
                        onClick={() => setPage((v) => Math.max(0, v - 1))}>
                  <ChevronUp size={11} />
                </button>
                <button className={pageBtn} disabled={page >= pages - 1}
                        title="Later channels" aria-label="Next channels"
                        onClick={() => setPage((v) => Math.min(pages - 1, v + 1))}>
                  <ChevronDown size={11} />
                </button>
              </>
            )}
            <span className="mono text-2xs tabular-nums text-fg-faint" title="amplitude per division">
              {perDiv.toFixed(0)} µV
            </span>
            <button className="rounded px-1 text-fg-dim hover:text-fg" aria-label="Increase gain"
                    title="Increase gain" onClick={() => setGain((g) => g * 1.3)}><Plus size={11} /></button>
            <button className="rounded px-1 text-fg-dim hover:text-fg" aria-label="Decrease gain"
                    title="Decrease gain" onClick={() => setGain((g) => g / 1.3)}><Minus size={11} /></button>
          </div>
        )
      }
    >
      <canvas
        ref={canvasRef}
        className="block h-full w-full cursor-crosshair touch-none"
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          if (e.clientX - e.currentTarget.getBoundingClientRect().left < GUTTER) return;
          const tt = pxToTime(e.clientX, e.currentTarget);
          if (tt != null) setCursor(tt);
        }}
        onPointerMove={(e) => {
          if (e.buttons === 1) {
            const tt = pxToTime(e.clientX, e.currentTarget);
            if (tt != null) setCursor(tt);
          }
        }}
        onClick={(e) => {
          if (e.clientX - e.currentTarget.getBoundingClientRect().left < GUTTER) {
            const ch = rowToChannel(e.clientY, e.currentTarget);
            if (ch) setFocusChannel(focusChannel === ch ? null : ch);
          }
        }}
        onWheel={(e) => {
          if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) return;
          setWindow(windowStart + (e.deltaX / 200) * windowDuration);
        }}
      />
    </Panel>
  );
}
