import { useRef, useState } from "react";
import { useCanvas } from "./useCanvas";
import { heat, rgb, type Scale } from "./scales";
import { linScale } from "./scales";
import { paint } from "./paint";
import { useStore } from "../../store/store";

interface Props {
  matrix: number[][];           // rows × cols
  rowLabels?: string[];
  colLabels?: string[];
  domain?: [number, number];
  /** override the theme heat ramp; gets t in [0,1] */
  colormap?: (t: number) => [number, number, number];
  onCell?: (row: number, col: number) => void;
  highlight?: { row?: number; col?: number };
  /** raw values behind the normalised matrix, for the hover readout */
  values?: number[][];
  valueLabel?: string;
}

const M = { top: 16, right: 8, bottom: 8, left: 44 };

export function Heatmap({
  matrix, rowLabels = [], colLabels = [], domain, colormap, onCell, highlight,
  values, valueLabel,
}: Props) {
  const geom = useRef<{ cw: number; ch: number } | null>(null);
  const themeTick = useStore((s) => s.themeTick);
  const [hover, setHover] = useState<{ r: number; c: number } | null>(null);
  const rows = matrix.length;
  const cols = rows ? matrix[0].length : 0;
  const flat = matrix.flat();
  const dom: [number, number] = domain ?? [Math.min(...flat), Math.max(...flat)];
  const norm: Scale = linScale(dom, [0, 1]);

  const canvasRef = useCanvas(({ ctx, width, height }) => {
    if (!rows || !cols) return;
    const p = paint(themeTick);
    // clear to the panel background so low cells melt into the card
    ctx.fillStyle = p.panel;
    ctx.fillRect(0, 0, width, height);
    const cmap = colormap ?? ((t: number) => heat(t, p.panel, p.accent, p.warn, p.text));
    const plotW = width - M.left - M.right;
    const plotH = height - M.top - M.bottom;
    const cw = plotW / cols;
    const ch = plotH / rows;
    geom.current = { cw, ch };

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        ctx.fillStyle = rgb(cmap(Math.max(0, Math.min(1, norm(matrix[r][c])))));
        ctx.fillRect(M.left + c * cw, M.top + r * ch, Math.ceil(cw), Math.ceil(ch));
      }
    }

    // highlight
    if (highlight) {
      ctx.strokeStyle = p.accent;
      ctx.lineWidth = 1.5;
      if (highlight.col != null)
        ctx.strokeRect(M.left + highlight.col * cw, M.top, cw, plotH);
      if (highlight.row != null)
        ctx.strokeRect(M.left, M.top + highlight.row * ch, plotW, ch);
    }

    // hover cell: an outline plus a readout, so a channel/band cell is a
    // number you can quote, not just a shade you can compare
    if (hover) {
      ctx.strokeStyle = p.text;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(M.left + hover.c * cw, M.top + hover.r * ch, cw, ch);
      const raw = values?.[hover.r]?.[hover.c];
      const line = `${rowLabels[hover.r] ?? `row ${hover.r}`} · ${colLabels[hover.c] ?? `col ${hover.c}`}` +
        (raw != null ? `  ${raw.toPrecision(3)}${valueLabel ? " " + valueLabel : ""}` : "");
      ctx.font = "10px ui-monospace, monospace";
      const bw = ctx.measureText(line).width + 12;
      const bx = Math.min(Math.max(M.left, M.left + (hover.c + 0.5) * cw - bw / 2), width - M.right - bw);
      const by = Math.max(2, M.top + hover.r * ch - 15);
      ctx.fillStyle = p.bg;
      ctx.globalAlpha = 0.94;
      ctx.fillRect(bx, by, bw, 14);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = p.gridStrong;
      ctx.lineWidth = 1;
      ctx.strokeRect(bx + 0.5, by + 0.5, bw, 14);
      ctx.fillStyle = p.text;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(line, bx + 6, by + 7);
    }

    ctx.font = "9px ui-monospace, monospace";
    ctx.fillStyle = p.textDim;
    ctx.textBaseline = "middle";
    ctx.textAlign = "right";
    // Thin the labels only when the caller labelled every row. A caller that
    // has already picked a handful of nice ticks (the spectrogram picks round
    // frequencies) must not have them dropped by a stride that lands between
    // them: stepping over an array that is mostly empty strings deletes labels
    // at random rather than evenly.
    const labelled = rowLabels.filter(Boolean).length;
    const fits = Math.max(1, Math.floor(plotH / 12));
    const rowStep = labelled > fits ? Math.ceil(rows / fits) : 1;
    for (let r = 0; r < rows; r += rowStep) {
      if (rowLabels[r]) ctx.fillText(rowLabels[r], M.left - 5, M.top + (r + 0.5) * ch);
    }
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "center";
    for (let c = 0; c < cols; c++) {
      if (colLabels[c]) ctx.fillText(colLabels[c], M.left + (c + 0.5) * cw, M.top - 5);
    }
  }, [themeTick, JSON.stringify({ matrix, dom, highlight, rowLabels, colLabels, hover })]);

  const at = (clientX: number, clientY: number, el: HTMLCanvasElement) => {
    if (!geom.current) return null;
    const rect = el.getBoundingClientRect();
    const c = Math.floor((clientX - rect.left - M.left) / geom.current.cw);
    const r = Math.floor((clientY - rect.top - M.top) / geom.current.ch);
    return r >= 0 && r < rows && c >= 0 && c < cols ? { r, c } : null;
  };

  return (
    <canvas
      ref={canvasRef}
      className="block h-full w-full cursor-crosshair"
      onMouseMove={(e) => {
        const cell = at(e.clientX, e.clientY, e.currentTarget);
        setHover((h) => (h?.r === cell?.r && h?.c === cell?.c ? h : cell));
      }}
      onMouseLeave={() => setHover(null)}
      onClick={(e) => {
        const cell = at(e.clientX, e.clientY, e.currentTarget);
        if (cell && onCell) onCell(cell.r, cell.c);
      }}
    />
  );
}
