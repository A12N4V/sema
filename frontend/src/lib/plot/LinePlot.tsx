import { useRef, useState } from "react";
import { useCanvas } from "./useCanvas";
import { linScale, invLinScale, ticks, type Scale } from "./scales";
import { paint } from "./paint";
import { useStore } from "../../store/store";

export interface Series {
  id: string;
  x: number[];
  y: number[];
  color?: string;
  width?: number;
  dash?: number[];
}

export interface VBand {
  from: number;
  to: number;
  color: string;
  label?: string;
}

interface Props {
  series: Series[];
  xDomain?: [number, number];
  yDomain?: [number, number];
  logX?: boolean;
  xLabel?: string;
  yLabel?: string;
  bands?: VBand[];
  cursorX?: number | null;
  onHoverX?: (x: number | null) => void;
  onClickX?: (x: number) => void;
}

const M = { top: 8, right: 10, bottom: 22, left: 44 };

/**
 * Axis numbers that fit the gutter. ICA activations are in arbitrary units and
 * routinely run to eight digits, which overflowed the left margin and drew over
 * the plot; anything that wide becomes an exponent instead.
 */
function axisNumber(v: number): string {
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e4 || a < 1e-3)) return v.toExponential(0).replace("e+", "e");
  return String(+v.toFixed(2));
}

export function LinePlot({
  series: rawSeries, xDomain, yDomain, logX = false, xLabel, yLabel, bands = [],
  cursorX, onHoverX, onClickX,
}: Props) {
  const geom = useRef<{ xs: Scale; xsInv: Scale; w: number } | null>(null);
  const themeTick = useStore((s) => s.themeTick);
  /** Where the pointer is, in data units. Drives the crosshair + readout. */
  const [hover, setHover] = useState<number | null>(null);

  const series = rawSeries.filter((s) => s.x?.length && s.y?.length && s.x.length === s.y.length);
  const allX = series.flatMap((s) => s.x);
  const allY = series.flatMap((s) => s.y);
  const xd: [number, number] = xDomain ?? [Math.min(...allX), Math.max(...allX)];
  const yd: [number, number] = yDomain ?? [Math.min(...allY), Math.max(...allY)];
  const tx = (v: number) => (logX ? Math.log10(Math.max(v, 1e-6)) : v);

  const canvasRef = useCanvas(({ ctx, width, height }) => {
    const p = paint(themeTick);
    const plotW = width - M.left - M.right;
    const plotH = height - M.top - M.bottom;
    const xs = linScale([tx(xd[0]), tx(xd[1])], [M.left, M.left + plotW]);
    const ys = linScale(yd, [M.top + plotH, M.top]);
    geom.current = {
      xs: (v: number) => xs(tx(v)),
      xsInv: (px: number) => {
        const raw = invLinScale([tx(xd[0]), tx(xd[1])], [M.left, M.left + plotW])(px);
        return logX ? Math.pow(10, raw) : raw;
      },
      w: width,
    };

    // frequency / value bands
    for (const b of bands) {
      ctx.fillStyle = b.color;
      const x0 = xs(tx(b.from));
      const x1 = xs(tx(b.to));
      ctx.fillRect(x0, M.top, x1 - x0, plotH);
    }

    // grid + ticks
    ctx.font = "10px ui-monospace, monospace";
    ctx.fillStyle = p.textFaint;
    ctx.strokeStyle = p.grid;
    ctx.lineWidth = 1;
    const yt = ticks(yd[0], yd[1], 5);
    for (const v of yt) {
      const py = Math.round(ys(v)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(M.left, py);
      ctx.lineTo(M.left + plotW, py);
      ctx.stroke();
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(axisNumber(v), M.left - 6, py);
    }
    const xtVals = logX
      ? [1, 2, 5, 10, 20, 30, 45, 60, 80].filter((v) => v >= xd[0] && v <= xd[1])
      : ticks(xd[0], xd[1], 6);
    for (const v of xtVals) {
      const px = Math.round(xs(tx(v))) + 0.5;
      ctx.beginPath();
      ctx.moveTo(px, M.top);
      ctx.lineTo(px, M.top + plotH);
      ctx.strokeStyle = p.grid;
      ctx.stroke();
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = p.textFaint;
      ctx.fillText(String(+v.toFixed(2)), px, M.top + plotH + 5);
    }

    // axis frame
    ctx.strokeStyle = p.gridStrong;
    ctx.strokeRect(M.left, M.top, plotW, plotH);

    // series
    for (const s of series) {
      ctx.beginPath();
      ctx.strokeStyle = s.color ?? p.accent;
      ctx.lineWidth = s.width ?? 1;
      ctx.setLineDash(s.dash ?? []);
      for (let i = 0; i < s.x.length; i++) {
        const px = xs(tx(s.x[i]));
        const py = ys(s.y[i]);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // cursor
    if (cursorX != null && cursorX >= xd[0] && cursorX <= xd[1]) {
      const px = Math.round(xs(tx(cursorX))) + 0.5;
      ctx.strokeStyle = p.cursor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px, M.top);
      ctx.lineTo(px, M.top + plotH);
      ctx.stroke();
    }

    // hover crosshair + readout: a value you can read is worth more than a
    // shape you can only squint at, and every one of these plots is quantitative
    if (hover != null && hover >= xd[0] && hover <= xd[1] && series.length) {
      const px = Math.round(xs(tx(hover))) + 0.5;
      ctx.save();
      ctx.strokeStyle = p.textFaint;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(px, M.top);
      ctx.lineTo(px, M.top + plotH);
      ctx.stroke();
      ctx.setLineDash([]);

      // the readable series (the thick ones) get a dot and a number
      const named = series.filter((s) => (s.width ?? 1) >= 1.1).slice(-2);
      const rows: { label: string; value: number; color: string; py: number }[] = [];
      for (const s of named) {
        let lo = 0;
        let hi = s.x.length - 1;
        while (hi - lo > 1) {
          const mid = (lo + hi) >> 1;
          if (s.x[mid] <= hover) lo = mid; else hi = mid;
        }
        const i = Math.abs(s.x[lo] - hover) <= Math.abs(s.x[hi] - hover) ? lo : hi;
        const py = ys(s.y[i]);
        rows.push({ label: s.id, value: s.y[i], color: s.color ?? p.accent, py });
        ctx.beginPath();
        ctx.fillStyle = s.color ?? p.accent;
        ctx.arc(xs(tx(s.x[i])), py, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.font = "10px ui-monospace, monospace";
      const lines = [
        `${+hover.toFixed(2)}${xLabel ? " " + xLabel : ""}`,
        ...rows.map((r) => `${r.label}  ${+r.value.toFixed(2)}`),
      ];
      const bw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 12;
      const bh = lines.length * 12 + 6;
      const bx = Math.min(px + 8, M.left + plotW - bw);
      const by = M.top + 4;
      ctx.fillStyle = p.panel;
      ctx.globalAlpha = 0.92;
      ctx.fillRect(bx, by, bw, bh);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = p.gridStrong;
      ctx.strokeRect(bx + 0.5, by + 0.5, bw, bh);
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      lines.forEach((l, i) => {
        ctx.fillStyle = i === 0 ? p.textDim : rows[i - 1].color;
        ctx.fillText(l, bx + 6, by + 4 + i * 12);
      });
      ctx.restore();
    }

    // labels
    ctx.fillStyle = p.textDim;
    ctx.font = "10px ui-sans-serif, system-ui";
    if (xLabel) {
      // above the tick row, not beside it: at the right edge the label and the
      // last tick label were drawn on top of each other
      ctx.textAlign = "right";
      ctx.textBaseline = "bottom";
      ctx.fillText(xLabel, M.left + plotW - 3, M.top + plotH - 3);
    }
    if (yLabel) {
      ctx.save();
      ctx.translate(10, M.top + 4);
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(yLabel, 0, 0);
      ctx.restore();
    }
  }, [themeTick, JSON.stringify({ n: series.map((s) => s.id + s.x.length), xd, yd, logX, bands, cursorX, hover })]);

  return (
    <canvas
      ref={canvasRef}
      className="block h-full w-full cursor-crosshair"
      onMouseMove={(e) => {
        if (!geom.current) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const x = geom.current.xsInv(e.clientX - rect.left);
        setHover(x);
        onHoverX?.(x);
      }}
      onMouseLeave={() => {
        setHover(null);
        onHoverX?.(null);
      }}
      onClick={(e) => {
        if (!onClickX || !geom.current) return;
        const rect = e.currentTarget.getBoundingClientRect();
        onClickX(geom.current.xsInv(e.clientX - rect.left));
      }}
    />
  );
}
