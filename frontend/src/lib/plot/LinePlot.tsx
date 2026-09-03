import { useRef } from "react";
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

export function LinePlot({
  series: rawSeries, xDomain, yDomain, logX = false, xLabel, yLabel, bands = [],
  cursorX, onHoverX, onClickX,
}: Props) {
  const geom = useRef<{ xs: Scale; xsInv: Scale; w: number } | null>(null);
  const themeTick = useStore((s) => s.themeTick);

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
      ctx.fillText(String(+v.toFixed(2)), M.left - 6, py);
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

    // labels
    ctx.fillStyle = p.textDim;
    ctx.font = "10px ui-sans-serif, system-ui";
    if (xLabel) {
      ctx.textAlign = "right";
      ctx.textBaseline = "bottom";
      ctx.fillText(xLabel, width - M.right, height - 2);
    }
    if (yLabel) {
      ctx.save();
      ctx.translate(10, M.top + 4);
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(yLabel, 0, 0);
      ctx.restore();
    }
  }, [themeTick, JSON.stringify({ n: series.map((s) => s.id + s.x.length), xd, yd, logX, bands, cursorX })]);

  return (
    <canvas
      ref={canvasRef}
      className="block h-full w-full"
      onMouseMove={(e) => {
        if (!onHoverX || !geom.current) return;
        const rect = e.currentTarget.getBoundingClientRect();
        onHoverX(geom.current.xsInv(e.clientX - rect.left));
      }}
      onMouseLeave={() => onHoverX?.(null)}
      onClick={(e) => {
        if (!onClickX || !geom.current) return;
        const rect = e.currentTarget.getBoundingClientRect();
        onClickX(geom.current.xsInv(e.clientX - rect.left));
      }}
    />
  );
}
