import { useRef } from "react";
import { useCanvas } from "./useCanvas";
import { magma, rgb, type Scale } from "./scales";
import { linScale } from "./scales";
import { paint } from "./paint";
import { useStore } from "../../store/store";

interface Props {
  matrix: number[][];           // rows × cols
  rowLabels?: string[];
  colLabels?: string[];
  domain?: [number, number];
  colormap?: (t: number) => [number, number, number];
  onCell?: (row: number, col: number) => void;
  highlight?: { row?: number; col?: number };
}

const M = { top: 16, right: 8, bottom: 8, left: 44 };

export function Heatmap({
  matrix, rowLabels = [], colLabels = [], domain, colormap = magma, onCell, highlight,
}: Props) {
  const geom = useRef<{ cw: number; ch: number } | null>(null);
  const themeTick = useStore((s) => s.themeTick);
  const rows = matrix.length;
  const cols = rows ? matrix[0].length : 0;
  const flat = matrix.flat();
  const dom: [number, number] = domain ?? [Math.min(...flat), Math.max(...flat)];
  const norm: Scale = linScale(dom, [0, 1]);

  const canvasRef = useCanvas(({ ctx, width, height }) => {
    if (!rows || !cols) return;
    const p = paint(themeTick);
    const plotW = width - M.left - M.right;
    const plotH = height - M.top - M.bottom;
    const cw = plotW / cols;
    const ch = plotH / rows;
    geom.current = { cw, ch };

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        ctx.fillStyle = rgb(colormap(Math.max(0, Math.min(1, norm(matrix[r][c])))));
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

    ctx.font = "9px ui-monospace, monospace";
    ctx.fillStyle = p.textDim;
    ctx.textBaseline = "middle";
    ctx.textAlign = "right";
    const rowStep = Math.ceil(rows / Math.max(1, Math.floor(plotH / 12)));
    for (let r = 0; r < rows; r += rowStep) {
      if (rowLabels[r]) ctx.fillText(rowLabels[r], M.left - 5, M.top + (r + 0.5) * ch);
    }
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "center";
    for (let c = 0; c < cols; c++) {
      if (colLabels[c]) ctx.fillText(colLabels[c], M.left + (c + 0.5) * cw, M.top - 5);
    }
  }, [themeTick, JSON.stringify({ matrix, dom, highlight, rowLabels, colLabels })]);

  return (
    <canvas
      ref={canvasRef}
      className="block h-full w-full"
      onClick={(e) => {
        if (!onCell || !geom.current) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const c = Math.floor((e.clientX - rect.left - M.left) / geom.current.cw);
        const r = Math.floor((e.clientY - rect.top - M.top) / geom.current.ch);
        if (r >= 0 && r < rows && c >= 0 && c < cols) onCell(r, c);
      }}
    />
  );
}
