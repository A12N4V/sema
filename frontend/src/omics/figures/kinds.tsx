import { useCallback, useEffect, useMemo, useState } from "react";
import type { Spec, Value } from "../api";
import { PlotCanvas, type Hit } from "../lib/plot/PlotCanvas";
import { CATS, groupColor, palette, ramp } from "../lib/plot/palette";
import { extent, fmt, type View } from "../lib/plot/scales";
import { useStore } from "../store";
import { defaults } from "./settings";

/**
 * One renderer per spec kind. Each turns (spec, settings) into a home domain,
 * a draw function and a hit test, and hands them to PlotCanvas; none of them
 * knows about gestures, sizing or axes.
 */
type S = Record<string, Value>;
interface P { spec: Spec; s: S; zkey: string }

const num = (v: Value | undefined, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const nl10 = (p: number | null) => (p == null || p <= 0 ? null : -Math.log10(Math.max(p, 1e-300)));
const Tip = ({ title, rows }: { title: string; rows: [string, string | number | null | undefined][] }) => (
  <div>
    <div className="mb-0.5 font-medium text-fg">{title}</div>
    {rows.map(([k, v]) => <div key={k} className="mono flex justify-between gap-3 text-2xs text-fg-dim"><span>{k}</span><span>{v == null ? "NA" : typeof v === "number" ? fmt(v) : v}</span></div>)}
  </div>
);

/** nearest point within r px, brute force (40k points is a few ms) */
function nearest(xs: Float64Array, ys: Float64Array, v: View, px: number, py: number, r = 8): number {
  let best = -1, bd = r * r;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i], y = ys[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const dx = v.px(x) - px, dy = v.py(y) - py, d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

// ================================================================== de
export function DEPlot({ spec, s, zkey }: P) {
  const gene = useStore((st) => st.gene);
  const setGene = (g: string) => useStore.getState().set({ gene: g });
  const view = s.view === "MA" ? "MA" : "volcano";
  const fdr = num(s.fdr, 0.05), lfcMin = num(s.lfc, 0.3), size = num(s.size, 2), nLab = num(s.labels, 12);
  const yKey = s.y === "p" ? "p" : "padj";

  const d = useMemo(() => {
    const n = spec.genes.length;
    const xs = new Float64Array(n), ys = new Float64Array(n), cls = new Uint8Array(n);   // 0 ns, 1 up, 2 down
    const lfcV: (number | null)[] = view === "MA" && spec.lfcShrunk ? spec.lfcShrunk : spec.lfc;
    for (let i = 0; i < n; i++) {
      const l = spec.lfc[i], q = yKey === "p" ? spec.p[i] : spec.padj[i];
      if (view === "MA") { xs[i] = spec.baseMean[i] > 0 ? Math.log10(spec.baseMean[i]) : NaN; ys[i] = lfcV[i] ?? NaN; }
      else { xs[i] = l ?? NaN; ys[i] = nl10(q) ?? NaN; }
      const sigP = (yKey === "p" ? spec.p[i] : spec.padj[i]);
      cls[i] = sigP != null && sigP < fdr && l != null && Math.abs(l) >= lfcMin ? (l > 0 ? 1 : 2) : 0;
    }
    const order = [...cls.keys()].filter((i) => cls[i]).sort((a, b) => (spec[yKey][a] ?? 1) - (spec[yKey][b] ?? 1));
    let up = 0, down = 0; for (const c of cls) { if (c === 1) up++; else if (c === 2) down++; }
    return { xs, ys, cls, labels: order.slice(0, nLab), up, down };
  }, [spec, view, yKey, fdr, lfcMin, nLab]);

  const home = useMemo(() => {
    const [x0, x1] = extent([...d.xs]); const [, y1] = extent([...d.ys]);
    if (view === "MA") { const [y0b, y1b] = extent([...d.ys]); return { x0, x1, y0: y0b, y1: y1b }; }
    const m = Math.max(Math.abs(x0), Math.abs(x1));
    return { x0: -m, x1: m, y0: 0, y1 };
  }, [d, view]);

  const sel = gene ? spec.genes.indexOf(gene) : -1;
  const draw = useCallback((ctx: CanvasRenderingContext2D, v: View) => {
    const p = palette();
    const col = [p.ns, p.up, p.down];
    // threshold guides
    ctx.setLineDash([4, 4]); ctx.strokeStyle = p.faint; ctx.lineWidth = 1;
    if (view === "volcano") {
      for (const xv of [-lfcMin, lfcMin]) { ctx.beginPath(); ctx.moveTo(v.px(xv), v.t); ctx.lineTo(v.px(xv), v.t + v.h); ctx.stroke(); }
      const yy = v.py(-Math.log10(fdr)); ctx.beginPath(); ctx.moveTo(v.l, yy); ctx.lineTo(v.l + v.w, yy); ctx.stroke();
    } else { const yy = v.py(0); ctx.beginPath(); ctx.moveTo(v.l, yy); ctx.lineTo(v.l + v.w, yy); ctx.stroke(); }
    ctx.setLineDash([]);
    for (const pass of [0, 2, 1]) {
      ctx.fillStyle = col[pass]; ctx.globalAlpha = pass ? 0.85 : 0.55;
      for (let i = 0; i < d.xs.length; i++) {
        if (d.cls[i] !== pass) continue;
        const x = d.xs[i], y = d.ys[i]; if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        ctx.fillRect(v.px(x) - size / 2, v.py(y) - size / 2, size, size);
      }
    }
    ctx.globalAlpha = 1;
    ctx.font = "italic 10px 'Space Grotesk', sans-serif"; ctx.fillStyle = p.fg; ctx.textBaseline = "bottom";
    for (const i of d.labels) { if (Number.isFinite(d.ys[i])) ctx.fillText(spec.genes[i], v.px(d.xs[i]) + 3, v.py(d.ys[i]) - 2); }
    if (sel >= 0 && Number.isFinite(d.xs[sel]) && Number.isFinite(d.ys[sel])) {
      const cx = v.px(d.xs[sel]), cy = v.py(d.ys[sel]);
      ctx.strokeStyle = p.accent; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, 7, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = p.accent; ctx.font = "600 11px 'Space Grotesk', sans-serif"; ctx.fillText(spec.genes[sel], cx + 9, cy - 4);
    }
    ctx.font = "10px 'JetBrains Mono', monospace"; ctx.textBaseline = "top";
    ctx.fillStyle = p.down; ctx.textAlign = "left"; ctx.fillText(`down ${d.down}`, v.l + 6, v.t + 6);
    ctx.fillStyle = p.up; ctx.textAlign = "right"; ctx.fillText(`up ${d.up}`, v.l + v.w - 6, v.t + 6); ctx.textAlign = "left";
  }, [d, size, view, fdr, lfcMin, sel, spec.genes]);

  const hit = useCallback((px: number, py: number, v: View): Hit | null => {
    const i = nearest(d.xs, d.ys, v, px, py);
    if (i < 0) return null;
    return { x: px, y: py, key: spec.genes[i], html: <Tip title={spec.genes[i]} rows={[["log2FC", spec.lfc[i]], ["padj", spec.padj[i]], ["p", spec.p[i]], ["baseMean", spec.baseMean[i]]]} /> };
  }, [d, spec]);

  return (
    <PlotCanvas zkey={zkey} home={home} draw={draw} hit={hit} onPick={(h) => h.key && setGene(h.key)}
      x={{ label: view === "MA" ? "mean of normalised counts" : `log2FC (${spec.test}/${spec.ref})`, tickFmt: view === "MA" ? (t) => fmt(10 ** t) : undefined }}
      y={{ label: view === "MA" ? (spec.lfcShrunk ? "log2FC (shrunk)" : "log2FC") : `−log10 ${yKey}` }} />
  );
}

// ================================================================== embedding
export function EmbeddingPlot({ spec, s, zkey }: P) {
  const xk = (s.x as string) in (spec.axes ?? {}) ? (s.x as string) : spec.x;
  const yk = (s.y as string) in (spec.axes ?? {}) ? (s.y as string) : spec.y;
  const ck = (s.colorBy as string) in (spec.color ?? {}) ? (s.colorBy as string) : spec.colorBy;
  const size = num(s.size, spec.pointSize ?? 3), alpha = num(s.alpha, 0.7);
  const showNames = !!s.labels && spec.names;

  const d = useMemo(() => {
    const xs = Float64Array.from(spec.axes[xk].values, (v: number | null) => v ?? NaN);
    const ys = Float64Array.from(spec.axes[yk].values, (v: number | null) => v ?? NaN);
    const c = spec.color?.[ck];
    let colors: string[] = [], legend: { name: string; color: string }[] = [];
    if (c?.type === "cat") {
      const levels = [...new Set<string>(c.values)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      const isGroup = ck === "group";
      const order = isGroup ? orderGroups(levels) : levels;
      const map = new Map(order.map((l, i) => [l, isGroup ? groupColor(l, order) : CATS[i % CATS.length]]));
      colors = c.values.map((v: string) => map.get(v)!);
      legend = order.map((l) => ({ name: l, color: map.get(l)! }));
    } else if (c?.type === "num") {
      const [lo, hi] = extent(c.values, 0);
      colors = c.values.map((v: number | null) => ramp(v == null ? NaN : (v - lo) / (hi - lo || 1)));
      legend = [{ name: `${fmt(lo)}`, color: ramp(0) }, { name: `${fmt(hi)}`, color: ramp(1) }];
    }
    return { xs, ys, colors, legend };
  }, [spec, xk, yk, ck]);

  const home = useMemo(() => { const [x0, x1] = extent([...d.xs], 0.06); const [y0, y1] = extent([...d.ys], 0.06); return { x0, x1, y0, y1 }; }, [d]);
  const draw = useCallback((ctx: CanvasRenderingContext2D, v: View) => {
    const p = palette();
    ctx.globalAlpha = alpha;
    const r = size / 2;
    for (let i = 0; i < d.xs.length; i++) {
      ctx.fillStyle = d.colors[i] ?? p.dim;
      if (size >= 5) { ctx.beginPath(); ctx.arc(v.px(d.xs[i]), v.py(d.ys[i]), r, 0, 6.283); ctx.fill(); }
      else ctx.fillRect(v.px(d.xs[i]) - r, v.py(d.ys[i]) - r, size, size);
    }
    ctx.globalAlpha = 1;
    if (showNames) {
      ctx.fillStyle = p.dim; ctx.font = "10px 'JetBrains Mono', monospace"; ctx.textBaseline = "bottom";
      spec.names.forEach((nm: string, i: number) => ctx.fillText(nm, v.px(d.xs[i]) + r + 2, v.py(d.ys[i]) - 2));
    }
    legendBox(ctx, v, d.legend);
  }, [d, size, alpha, showNames, spec.names]);
  const hit = useCallback((px: number, py: number, v: View): Hit | null => {
    const i = nearest(d.xs, d.ys, v, px, py, Math.max(6, size));
    if (i < 0) return null;
    const rows: [string, string | number | null][] = Object.entries(spec.color ?? {}).map(([k, c]) => [k, (c as { values: (string | number | null)[] }).values[i]]);
    return { x: px, y: py, html: <Tip title={spec.names?.[i] ?? `point ${i}`} rows={rows} /> };
  }, [d, spec, size]);

  return <PlotCanvas zkey={zkey} home={home} draw={draw} hit={hit} x={{ label: spec.axes[xk].label }} y={{ label: spec.axes[yk].label }} />;
}

function orderGroups(levels: string[]): string[] {
  const ref = ["V", "VEH"].find((r) => levels.includes(r));
  return ref ? [ref, ...levels.filter((l) => l !== ref)] : levels;
}

function legendBox(ctx: CanvasRenderingContext2D, v: View, items: { name: string; color: string }[]) {
  if (!items.length) return;
  const p = palette();
  ctx.font = "10px 'JetBrains Mono', monospace"; ctx.textBaseline = "middle"; ctx.textAlign = "left";
  const shown = items.slice(0, 22);
  const w = Math.min(180, 18 + Math.max(...shown.map((i) => ctx.measureText(i.name).width)));
  const h = shown.length * 14 + 8;
  const x = v.l + v.w - w - 6, y = v.t + 6;
  ctx.fillStyle = "rgba(10,11,14,0.82)"; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = p.seam; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  shown.forEach((it, i) => {
    ctx.fillStyle = it.color; ctx.fillRect(x + 6, y + 8 + i * 14, 7, 7);
    ctx.fillStyle = p.dim; ctx.fillText(it.name.slice(0, 22), x + 18, y + 12 + i * 14);
  });
}

// ================================================================== groups
export function GroupsPlot({ spec, s, zkey }: P) {
  const metric = (s.metric as string) in spec.metrics ? (s.metric as string) : Object.keys(spec.metrics)[0];
  const m = spec.metrics[metric];
  const mode = (s.mode as string) || spec.mode || "box";
  const logy = !!s.log, showPts = s.points !== false;
  const order: string[] = spec.groupOrder ?? [...new Set<string>(m.group)];

  const d = useMemo(() => {
    const cats = [...new Set<string>(m.x)];
    const tv = (v: number | null) => (v == null ? NaN : logy ? (v > 0 ? Math.log10(v) : NaN) : v);
    const byGroups = cats.length !== m.x.length && cats.join() !== order.join();   // x != group: dodge by group
    const ng = order.length;
    const pos = (ci: number, g: string) => ci + (byGroups && ng > 1 ? (order.indexOf(g) - (ng - 1) / 2) * (0.8 / ng) : 0);
    const pts = m.value.map((v: number | null, i: number) => ({ x: pos(cats.indexOf(m.x[i]), m.group[i]), y: tv(v), g: m.group[i], id: m.id[i], raw: v, cat: m.x[i] }));
    const boxes: { x: number; g: string; vals: number[]; w: number }[] = [];
    for (const [ci, c] of cats.entries()) for (const g of order) {
      const vals = pts.filter((p: { cat: string; g: string; y: number }) => p.cat === c && p.g === g && Number.isFinite(p.y)).map((p: { y: number }) => p.y).sort((a: number, b: number) => a - b);
      if (vals.length) boxes.push({ x: pos(ci, g), g, vals, w: byGroups ? 0.7 / ng : 0.6 });
    }
    return { cats, pts, boxes };
  }, [m, logy, order]);

  const home = useMemo(() => {
    const [y0, y1] = extent(d.pts.map((p: { y: number }) => p.y), 0.08);
    const base = mode === "bars" && !logy ? Math.min(0, y0) : y0;
    return { x0: -0.7, x1: d.cats.length - 0.3, y0: base, y1 };
  }, [d, mode, logy]);

  const draw = useCallback((ctx: CanvasRenderingContext2D, v: View) => {
    const p = palette();
    const q = (a: number[], t: number) => a[Math.min(a.length - 1, Math.max(0, Math.round(t * (a.length - 1))))];
    for (const b of d.boxes) {
      const c = groupColor(b.g, order);
      const hw = (v.px(b.w / 2) - v.px(0));
      const cx = v.px(b.x);
      if (mode === "bars") {
        const mean = b.vals.reduce((a, x) => a + x, 0) / b.vals.length;
        const sd = Math.sqrt(b.vals.reduce((a, x) => a + (x - mean) ** 2, 0) / Math.max(1, b.vals.length - 1));
        const se = sd / Math.sqrt(b.vals.length);
        ctx.fillStyle = c; ctx.globalAlpha = 0.55;
        const y0 = v.py(Math.max(home.y0, 0)), y1 = v.py(mean);
        ctx.fillRect(cx - hw, Math.min(y0, y1), hw * 2, Math.abs(y1 - y0)); ctx.globalAlpha = 1;
        ctx.strokeStyle = c; ctx.beginPath(); ctx.moveTo(cx, v.py(mean - se)); ctx.lineTo(cx, v.py(mean + se)); ctx.stroke();
      } else if (mode === "box") {
        const [q1, md, q3] = [q(b.vals, 0.25), q(b.vals, 0.5), q(b.vals, 0.75)];
        ctx.strokeStyle = c; ctx.lineWidth = 1.2;
        ctx.strokeRect(cx - hw, v.py(q3), hw * 2, v.py(q1) - v.py(q3));
        ctx.beginPath(); ctx.moveTo(cx - hw, v.py(md)); ctx.lineTo(cx + hw, v.py(md));
        ctx.moveTo(cx, v.py(q3)); ctx.lineTo(cx, v.py(b.vals[b.vals.length - 1]));
        ctx.moveTo(cx, v.py(q1)); ctx.lineTo(cx, v.py(b.vals[0])); ctx.stroke();
      } else if (mode === "violin") {
        const [lo, hi] = [b.vals[0], b.vals[b.vals.length - 1]];
        const bw = (hi - lo || 1) / 12, steps = 40, dens: number[] = [];
        for (let k = 0; k <= steps; k++) {
          const y = lo + ((hi - lo) * k) / steps; let s2 = 0;
          for (const x of b.vals) s2 += Math.exp(-0.5 * ((x - y) / bw) ** 2);
          dens.push(s2);
        }
        const mx = Math.max(...dens) || 1;
        ctx.fillStyle = c; ctx.globalAlpha = 0.35; ctx.beginPath();
        dens.forEach((dd, k) => { const y = v.py(lo + ((hi - lo) * k) / steps); const w = (dd / mx) * hw; k ? ctx.lineTo(cx + w, y) : ctx.moveTo(cx + w, y); });
        for (let k = steps; k >= 0; k--) ctx.lineTo(cx - (dens[k] / mx) * hw, v.py(lo + ((hi - lo) * k) / steps));
        ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
        ctx.strokeStyle = p.fg; ctx.beginPath(); ctx.moveTo(cx - hw * 0.3, v.py(q(b.vals, 0.5))); ctx.lineTo(cx + hw * 0.3, v.py(q(b.vals, 0.5))); ctx.stroke();
      }
    }
    if (showPts || mode === "points") {
      const many = d.pts.length > 400;
      for (const [i, pt] of d.pts.entries()) {
        if (!Number.isFinite(pt.y)) continue;
        const jitter = ((i * 2654435761) % 1000) / 1000 - 0.5;
        const w = d.boxes[0]?.w ?? 0.6;
        ctx.fillStyle = groupColor(pt.g, order); ctx.globalAlpha = many ? 0.35 : 0.95;
        const r = many ? 1 : 3;
        ctx.beginPath(); ctx.arc(v.px(pt.x + jitter * w * 0.5), v.py(pt.y), r, 0, 6.283); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    legendBox(ctx, v, order.map((g) => ({ name: g, color: groupColor(g, order) })));
  }, [d, mode, showPts, order, home.y0]);

  const hit = useCallback((px: number, py: number, v: View): Hit | null => {
    if (d.pts.length > 2000) return null;
    let best = -1, bd = 100;
    d.pts.forEach((pt: { x: number; y: number }, i: number) => {
      if (!Number.isFinite(pt.y)) return;
      const dd = Math.abs(v.px(pt.x) - px) * 0.5 + Math.abs(v.py(pt.y) - py);
      if (dd < bd) { bd = dd; best = i; }
    });
    if (best < 0 || bd > 18) return null;
    const pt = d.pts[best];
    return { x: px, y: py, html: <Tip title={pt.id} rows={[[m.label, pt.raw], ["group", pt.g], ["category", pt.cat]]} /> };
  }, [d, m.label]);

  return <PlotCanvas zkey={zkey} home={home} draw={draw} hit={hit} lock="x"
    x={{ cats: d.cats }} y={{ label: m.label + (logy ? " (log10)" : ""), tickFmt: logy ? (t) => fmt(10 ** t) : undefined }} />;
}

// ================================================================== enrichment
export function EnrichmentPlot({ spec, s, zkey }: P) {
  const fdr = num(s.fdr, 0.05), top = num(s.top, 15), set = (s.set as string) || "all", sort = s.sort === "padj" ? "padj" : "score";
  const rows = useMemo(() => {
    const idx = spec.terms.map((_: string, i: number) => i).filter((i: number) => (set === "all" || spec.set[i] === set) && spec.score[i] != null);
    const sig = idx.filter((i: number) => (spec.padj[i] ?? 1) < fdr);
    const pool = sig.length ? sig : idx;
    let chosen: number[];
    if (spec.oneSided) chosen = [...pool].sort((a, b) => (spec.padj[a] ?? 1) - (spec.padj[b] ?? 1)).slice(0, top);
    else {
      const pos = pool.filter((i: number) => spec.score[i] > 0).sort((a: number, b: number) => (spec.padj[a] ?? 1) - (spec.padj[b] ?? 1)).slice(0, Math.ceil(top / 2));
      const neg = pool.filter((i: number) => spec.score[i] < 0).sort((a: number, b: number) => (spec.padj[a] ?? 1) - (spec.padj[b] ?? 1)).slice(0, Math.floor(top / 2));
      chosen = [...pos, ...neg];
    }
    chosen.sort((a, b) => sort === "padj" ? (spec.padj[b] ?? 1) - (spec.padj[a] ?? 1) : spec.score[a] - spec.score[b]);
    return { chosen, sigCount: sig.length };
  }, [spec, fdr, top, set, sort]);

  const home = useMemo(() => {
    const [x0, x1] = extent(rows.chosen.map((i) => spec.score[i]), 0.1);
    return { x0: spec.oneSided ? 0 : Math.min(x0, 0), x1: Math.max(x1, 0), y0: -0.7, y1: Math.max(rows.chosen.length - 0.3, 0.3) };
  }, [rows, spec]);
  const maxSize = useMemo(() => Math.max(1, ...rows.chosen.map((i) => spec.size[i] ?? 1)), [rows, spec]);
  const draw = useCallback((ctx: CanvasRenderingContext2D, v: View) => {
    const p = palette();
    ctx.strokeStyle = p.faint; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(v.px(0), v.t); ctx.lineTo(v.px(0), v.t + v.h); ctx.stroke(); ctx.setLineDash([]);
    const pmax = Math.max(1, ...rows.chosen.map((i) => -Math.log10(Math.max(spec.padj[i] ?? 1, 1e-10))));
    rows.chosen.forEach((i, k) => {
      const sig = (spec.padj[i] ?? 1) < fdr;
      const t = -Math.log10(Math.max(spec.padj[i] ?? 1, 1e-10)) / pmax;
      ctx.strokeStyle = p.seamBright; ctx.beginPath(); ctx.moveTo(v.px(0), v.py(k)); ctx.lineTo(v.px(spec.score[i]), v.py(k)); ctx.stroke();
      ctx.fillStyle = sig ? ramp(0.35 + 0.65 * t) : p.faint;
      ctx.beginPath(); ctx.arc(v.px(spec.score[i]), v.py(k), 3 + 7 * Math.sqrt((spec.size[i] ?? 1) / maxSize), 0, 6.283); ctx.fill();
    });
    if (!rows.sigCount) { ctx.fillStyle = p.warn; ctx.font = "11px 'Space Grotesk', sans-serif"; ctx.fillText(`nothing passes FDR ${fdr}; showing the strongest terms`, v.l + 8, v.t + 14); }
  }, [rows, spec, fdr, maxSize]);
  const hit = useCallback((px: number, py: number, v: View): Hit | null => {
    const k = Math.round(v.iy(py)); const i = rows.chosen[k];
    if (i == null) return null;
    return { x: px, y: py, html: <Tip title={spec.terms[i]} rows={[[spec.scoreLabel, spec.score[i]], ["padj", spec.padj[i]], ["size", spec.size[i]], ["set", spec.set[i]]]} /> };
  }, [rows, spec]);
  return <PlotCanvas zkey={zkey} home={home} draw={draw} hit={hit} x={{ label: spec.scoreLabel }} y={{ cats: rows.chosen.map((i) => spec.terms[i]) }} margin={{ l: 230 }} />;
}

// ================================================================== heatmap
export function HeatmapPlot({ spec, s, zkey }: P) {
  const clip = num(s.clip, spec.scale === "diverging" ? 2.5 : 1);
  const showVals = !!s.values;
  const setGene = (g: string) => useStore.getState().set({ gene: g });
  const gene = useStore((st) => st.gene);
  const [lo, hi] = useMemo(() => {
    if (spec.scale === "diverging") return [-clip, clip];
    const [a, b] = extent(spec.z.flat(), 0); return [a, b];
  }, [spec, clip]);
  const nr = spec.rows.length, nc = spec.cols.length;
  const home = { x0: -0.5, x1: nc - 0.5, y0: -0.5, y1: nr - 0.5 };
  const groupOrder = useMemo(() => orderGroups([...new Set<string>(spec.colGroups ?? [])]), [spec]);
  const draw = useCallback((ctx: CanvasRenderingContext2D, v: View) => {
    const p = palette();
    const cw = Math.abs(v.px(1) - v.px(0)), rh = Math.abs(v.py(1) - v.py(0));
    for (let r = 0; r < nr; r++) {
      const ry = nr - 1 - r;                          // first row at the top
      if (v.py(ry) + rh < v.t || v.py(ry) - rh > v.t + v.h) continue;
      for (let c = 0; c < nc; c++) {
        const z = spec.z[r][c];
        ctx.fillStyle = ramp(z == null ? NaN : (z - lo) / (hi - lo || 1), spec.scale === "diverging" ? "diverging" : "sequential");
        ctx.fillRect(v.px(c) - cw / 2, v.py(ry) - rh / 2, cw + 0.5, rh + 0.5);
        if (showVals && cw > 30 && rh > 12 && z != null) {
          ctx.fillStyle = p.fg; ctx.font = "9px 'JetBrains Mono', monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText(fmt(z), v.px(c), v.py(ry)); ctx.textAlign = "left";
        }
      }
      if (spec.rowIds && spec.rows[r] === gene) {
        ctx.strokeStyle = p.accent; ctx.lineWidth = 2; ctx.strokeRect(v.px(-0.5), v.py(ry) - rh / 2, v.px(nc - 0.5) - v.px(-0.5), rh);
      }
    }
    if (spec.colGroups) spec.colGroups.forEach((g: string, c: number) => {
      ctx.fillStyle = groupColor(g, groupOrder); ctx.fillRect(v.px(c) - cw / 2, v.t, cw, 4);
    });
  }, [spec, lo, hi, nr, nc, showVals, gene, groupOrder]);
  const hit = useCallback((px: number, py: number, v: View): Hit | null => {
    const c = Math.round(v.ix(px)), ry = Math.round(v.iy(py)), r = nr - 1 - ry;
    if (c < 0 || c >= nc || r < 0 || r >= nr) return null;
    return { x: px, y: py, key: spec.rowIds ? spec.rows[r] : undefined,
      html: <Tip title={spec.rows[r]} rows={[["column", spec.cols[c]], [spec.label ?? "value", spec.z[r][c]], ...(spec.colGroups ? [["group", spec.colGroups[c]] as [string, string]] : [])]} /> };
  }, [spec, nr, nc]);
  const rowsTopDown = useMemo(() => [...spec.rows].reverse(), [spec.rows]);
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1">
        <PlotCanvas zkey={zkey} home={home} draw={draw} hit={hit} onPick={(h) => h.key && setGene(h.key)}
          x={{ cats: spec.cols }} y={{ cats: rowsTopDown }} margin={{ l: 120, t: 12 }} />
      </div>
      <ColorBar lo={lo} hi={hi} kind={spec.scale === "diverging" ? "diverging" : "sequential"} label={spec.label} />
    </div>
  );
}

function ColorBar({ lo, hi, kind, label }: { lo: number; hi: number; kind: "diverging" | "sequential"; label?: string }) {
  const stops = Array.from({ length: 11 }, (_, i) => ramp(i / 10, kind)).join(",");
  return (
    <div className="mono flex shrink-0 items-center gap-2 px-3 pb-1.5 text-2xs text-fg-faint">
      <span>{fmt(lo)}</span>
      <span className="h-2 w-40 rounded-xs" style={{ background: `linear-gradient(90deg, ${stops})` }} />
      <span>{fmt(hi)}</span>
      {label && <span className="truncate">{label}</span>}
    </div>
  );
}

// ================================================================== effects
export function EffectsPlot({ spec, s, zkey }: P) {
  const order = useMemo(() => {
    const idx = spec.labels.map((_: string, i: number) => i);
    return s.sort === "label" ? idx.sort((a: number, b: number) => spec.labels[b].localeCompare(spec.labels[a])) : idx.sort((a: number, b: number) => spec.est[a] - spec.est[b]);
  }, [spec, s.sort]);
  const home = useMemo(() => {
    const [x0, x1] = extent([...spec.lo, ...spec.hi, 0], 0.08);
    return { x0, x1, y0: -0.7, y1: order.length - 0.3 };
  }, [spec, order]);
  const draw = useCallback((ctx: CanvasRenderingContext2D, v: View) => {
    const p = palette();
    ctx.strokeStyle = p.faint; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(v.px(0), v.t); ctx.lineTo(v.px(0), v.t + v.h); ctx.stroke(); ctx.setLineDash([]);
    order.forEach((i: number, k: number) => {
      const sig = (spec.padj[i] ?? 1) < 0.05;
      ctx.strokeStyle = sig ? p.accent : p.dim; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(v.px(spec.lo[i]), v.py(k)); ctx.lineTo(v.px(spec.hi[i]), v.py(k)); ctx.stroke();
      ctx.fillStyle = sig ? p.accent : p.fg; ctx.beginPath(); ctx.arc(v.px(spec.est[i]), v.py(k), 4, 0, 6.283); ctx.fill();
    });
  }, [spec, order]);
  const hit = useCallback((px: number, py: number, v: View): Hit | null => {
    const i = order[Math.round(v.iy(py))]; if (i == null) return null;
    return { x: px, y: py, html: <Tip title={spec.labels[i]} rows={[["estimate", spec.est[i]], ["95% CI", `${fmt(spec.lo[i])} – ${fmt(spec.hi[i])}`], ["p", spec.p[i]], ["FDR", spec.padj[i]]]} /> };
  }, [spec, order]);
  return <PlotCanvas zkey={zkey} home={home} draw={draw} hit={hit} lock="y" x={{ label: spec.xLabel }} y={{ cats: order.map((i: number) => spec.labels[i]) }} />;
}

// ================================================================== xy
export function XYPlot({ spec, s, zkey }: P) {
  const size = num(s.size, 3), diag = !!s.diag;
  const d = useMemo(() => ({ xs: Float64Array.from(spec.x, (v: number | null) => v ?? NaN), ys: Float64Array.from(spec.y, (v: number | null) => v ?? NaN) }), [spec]);
  const home = useMemo(() => { const [x0, x1] = extent([...d.xs]); const [y0, y1] = extent([...d.ys]); return { x0, x1, y0, y1 }; }, [d]);
  const draw = useCallback((ctx: CanvasRenderingContext2D, v: View) => {
    const p = palette();
    if (diag) { ctx.strokeStyle = p.up; ctx.beginPath(); const a = Math.min(home.x0, home.y0), b = Math.max(home.x1, home.y1); ctx.moveTo(v.px(a), v.py(a)); ctx.lineTo(v.px(b), v.py(b)); ctx.stroke(); }
    if (spec.line) { ctx.strokeStyle = p.accent; ctx.beginPath(); d.xs.forEach((x, i) => (i ? ctx.lineTo(v.px(x), v.py(d.ys[i])) : ctx.moveTo(v.px(x), v.py(d.ys[i])))); ctx.stroke(); }
    ctx.fillStyle = spec.line ? p.accent : p.fg; ctx.globalAlpha = spec.line ? 1 : 0.5;
    for (let i = 0; i < d.xs.length; i++) { ctx.beginPath(); ctx.arc(v.px(d.xs[i]), v.py(d.ys[i]), size / 2 + (spec.line ? 1.5 : 0), 0, 6.283); ctx.fill(); }
    ctx.globalAlpha = 1;
  }, [d, size, diag, home, spec.line]);
  const hit = useCallback((px: number, py: number, v: View): Hit | null => {
    const i = nearest(d.xs, d.ys, v, px, py); if (i < 0) return null;
    return { x: px, y: py, html: <Tip title={spec.ids?.[i] ?? `${i}`} rows={[[spec.xLabel, spec.x[i]], [spec.yLabel, spec.y[i]]]} /> };
  }, [d, spec]);
  return <PlotCanvas zkey={zkey} home={home} draw={draw} hit={hit} x={{ label: spec.xLabel }} y={{ label: spec.yLabel }} />;
}

// ================================================================== gene
export function GenePlot({ spec, s, zkey }: P) {
  const order = useMemo(() => orderGroups([...new Set<string>(spec.group)]), [spec]);
  const pts = useMemo(() => spec.value.map((v: number | null, i: number) => ({ x: order.indexOf(spec.group[i]), y: v ?? NaN, id: spec.samples[i], g: spec.group[i] })), [spec, order]);
  const home = useMemo(() => { const [y0, y1] = extent(pts.map((p: { y: number }) => p.y), 0.15); return { x0: -0.6, x1: order.length - 0.4, y0, y1 }; }, [pts, order]);
  const draw = useCallback((ctx: CanvasRenderingContext2D, v: View) => {
    const p = palette();
    order.forEach((g, gi) => {
      const vals = pts.filter((q: { g: string }) => q.g === g).map((q: { y: number }) => q.y).filter(Number.isFinite);
      if (!vals.length) return;
      const mean = vals.reduce((a: number, b: number) => a + b, 0) / vals.length;
      ctx.strokeStyle = groupColor(g, order); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(v.px(gi - 0.25), v.py(mean)); ctx.lineTo(v.px(gi + 0.25), v.py(mean)); ctx.stroke();
    });
    pts.forEach((q: { x: number; y: number; id: string; g: string }, i: number) => {
      const jx = q.x + (((i * 7919) % 100) / 100 - 0.5) * 0.3;
      ctx.fillStyle = groupColor(q.g, order); ctx.beginPath(); ctx.arc(v.px(jx), v.py(q.y), 5, 0, 6.283); ctx.fill();
      if (s.labels !== false) { ctx.fillStyle = p.faint; ctx.font = "10px 'JetBrains Mono', monospace"; ctx.fillText(q.id, v.px(jx) + 7, v.py(q.y) + 3); }
    });
  }, [pts, order, s.labels]);
  return <PlotCanvas zkey={zkey} home={home} draw={draw} lock="x" x={{ cats: order }} y={{ label: spec.yLabel }} />;
}

// ================================================================== histogram
export function HistogramPlot({ spec, s, zkey }: P) {
  const logY = !!s.log;
  const edges: number[] = spec.edges ?? [], counts: number[] = spec.counts ?? [];
  const [cut, setCut] = useState<number | null>(spec.cutDefault ?? null);
  useEffect(() => { setCut(spec.cutDefault ?? null); }, [spec.column]); // eslint-disable-line react-hooks/exhaustive-deps
  const above = useMemo(() => {
    if (cut == null) return null;
    let n = 0;
    for (let i = 0; i < counts.length; i++) if (edges[i] >= cut) n += counts[i];
    return n;
  }, [cut, counts, edges]);
  const home = useMemo(() => {
    const m = Math.max(1, ...counts.map((c: number) => (logY ? Math.log10(c + 1) : c)));
    return { x0: edges[0] ?? 0, x1: edges[edges.length - 1] ?? 1, y0: 0, y1: m * 1.05 };
  }, [counts, edges, logY]);
  const yOf = useCallback((c: number) => (logY ? Math.log10(Math.max(c, 0) + 1) : c), [logY]);
  const draw = useCallback((ctx: CanvasRenderingContext2D, v: View) => {
    const p = palette();
    const w = (edges.length > 1 ? v.px(edges[1]) - v.px(edges[0]) : v.w / 60) - 1;
    for (let i = 0; i < counts.length; i++) {
      const x = v.px(edges[i]);
      if (x + w < v.l || x > v.l + v.w) continue;
      const y = v.py(yOf(counts[i]));
      ctx.fillStyle = cut != null && edges[i] >= cut ? p.accent : p.fg;
      ctx.globalAlpha = cut != null && edges[i] >= cut ? 0.9 : 0.45;
      ctx.fillRect(x, Math.min(y, v.t + v.h), Math.max(1, w), v.t + v.h - Math.min(y, v.t + v.h));
    }
    ctx.globalAlpha = 1;
    if (cut != null) {
      const px = v.px(cut);
      if (px >= v.l - 1 && px <= v.l + v.w + 1) {
        ctx.strokeStyle = p.accent; ctx.lineWidth = 1.5; ctx.setLineDash([5, 3]);
        ctx.beginPath(); ctx.moveTo(px, v.t); ctx.lineTo(px, v.t + v.h); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = p.accent; ctx.font = "10px 'JetBrains Mono', monospace"; ctx.textBaseline = "top";
        ctx.fillText(`${spec.column} ≥ ${fmt(cut)} · ${above ?? 0} genes`, Math.min(px + 6, v.l + v.w - 150), v.t + 6);
      }
    }
  }, [edges, counts, cut, above, logY, yOf, spec.column]);
  const hit = useCallback((px: number, py: number, v: View): Hit | null => {
    const i = Math.floor((v.ix(px) - edges[0]) / ((edges[edges.length - 1] - edges[0]) / counts.length));
    if (i < 0 || i >= counts.length) return null;
    return { x: px, y: py, html: <Tip title={`${fmt(edges[i])} – ${fmt(edges[i + 1])}`} rows={[["genes", counts[i]], ["column", spec.column], ["NA dropped", spec.na]]} /> };
  }, [edges, counts, spec]);
  const onDrag = useCallback((v: View, px: number) => {
    const x = v.ix(px);
    setCut(Math.min(edges[edges.length - 1] ?? 1, Math.max(edges[0] ?? 0, x)));
  }, [edges]);
  return (
    <PlotCanvas zkey={zkey} home={home} draw={draw} hit={hit} drag={onDrag}
      x={{ label: spec.column }} y={{ label: logY ? "genes (log10)" : "genes" }} />
  );
}

// ================================================================== dotplot
export function DotPlotPlot({ spec, s, zkey }: P) {
  const per = Math.max(1, Math.min(spec.perCluster ?? 12, num(s.per, 6)));
  const sizeMax = num(s.sizeMax, 14);
  const d = useMemo(() => {
    const rows: { c: number; g: number; gene: string; lfc: number | null; pct: number; score: number | null }[] = [];
    const clusters: string[] = spec.clusters ?? [];
    clusters.forEach((c, ci) => {
      for (const r of (spec.rows ?? []).filter((r: { cluster: string }) => r.cluster === c).slice(0, per))
        rows.push({ c: ci, g: rows.length, gene: r.gene, lfc: r.lfc, pct: r.pct, score: r.score });
    });
    const lfcs = rows.map((r) => r.lfc).filter((v): v is number => v != null && Number.isFinite(v));
    const m = Math.max(0.1, ...lfcs.map(Math.abs));
    return { rows, clusters, m };
  }, [spec, per]);
  const home = useMemo(() => ({ x0: -0.5, x1: d.clusters.length - 0.5, y0: -0.5, y1: d.rows.length - 0.5 }), [d]);
  const draw = useCallback((ctx: CanvasRenderingContext2D, v: View) => {
    const p = palette();
    for (const r of d.rows) {
      const cx = v.px(r.c), cy = v.py(r.g);
      const rad = 2 + (sizeMax / 2 - 2) * Math.min(1, Math.max(0, r.pct));
      ctx.fillStyle = ramp(r.lfc == null ? NaN : 0.5 + (r.lfc / (2 * d.m)) * 0.5, "diverging");
      ctx.beginPath(); ctx.arc(cx, cy, rad, 0, 6.283); ctx.fill();
      if (r.pct >= 0.999) { ctx.strokeStyle = p.fg; ctx.lineWidth = 1; ctx.stroke(); }
    }
  }, [d, sizeMax]);
  const hit = useCallback((px: number, py: number, v: View): Hit | null => {
    let best = -1, bd = 400;
    d.rows.forEach((r, i) => {
      const dx = v.px(r.c) - px, dy = v.py(r.g) - py, dd = dx * dx + dy * dy;
      if (dd < bd) { bd = dd; best = i; }
    });
    if (best < 0) return null;
    const r = d.rows[best];
    return { x: px, y: py, key: r.gene, html: <Tip title={r.gene} rows={[["cluster", d.clusters[r.c]], ["mean log2FC", r.lfc], ["% expressing", r.pct == null ? null : `${Math.round(r.pct * 100)}%`], ["score", r.score]]} /> };
  }, [d]);
  return (
    <PlotCanvas zkey={zkey} home={home} draw={draw} hit={hit} onPick={(h) => h.key && useStore.getState().set({ gene: h.key })}
      lock="y" x={{ cats: d.clusters.map((c) => `cluster ${c}`) }} y={{ cats: d.rows.map((r) => r.gene) }} />
  );
}

// ================================================================== overlap matrix
export function OverlapPlot({ spec, s, zkey }: P) {
  const showVals = !!s.values;
  const sets: string[] = spec.sets ?? [], z: (number | null)[][] = spec.z ?? [];
  const max = useMemo(() => Math.max(1, ...z.flat().map((v) => v ?? 0)), [z]);
  const home = useMemo(() => ({ x0: -0.5, x1: sets.length - 0.5, y0: -0.5, y1: sets.length - 0.5 }), [sets.length]);
  const draw = useCallback((ctx: CanvasRenderingContext2D, v: View) => {
    const cw = v.w / Math.max(1, sets.length), ch = v.h / Math.max(1, sets.length);
    for (let i = 0; i < sets.length; i++) for (let j = 0; j < sets.length; j++) {
      const val = z[i]?.[j];
      const x = v.px(i) - cw / 2, y = v.py(j) - ch / 2;
      ctx.fillStyle = val == null ? "transparent" : ramp(val / max);
      if (val != null) ctx.fillRect(x + 1, y + 1, Math.max(1, cw - 2), Math.max(1, ch - 2));
      if (showVals && val != null && cw > 22 && ch > 16) {
        ctx.fillStyle = palette().bg; ctx.font = "10px 'JetBrains Mono', monospace";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(String(val), x + cw / 2, y + ch / 2); ctx.textAlign = "left";
      }
    }
  }, [sets.length, z, max, showVals]);
  const hit = useCallback((px: number, py: number, v: View): Hit | null => {
    const i = Math.floor(v.ix(px) + 0.5), j = Math.floor(v.iy(py) + 0.5);
    if (i < 0 || j < 0 || i >= sets.length || j >= sets.length) return null;
    const val = z[i]?.[j];
    const gs = spec.genes?.[i]?.[j] ?? [];
    return { x: px, y: py, html: <Tip title={`${sets[i]} × ${sets[j]}`} rows={[["shared", val], ...gs.slice(0, 8).map((g: string) => ["", g] as [string, string]), ...(gs.length > 8 ? [["", `+ ${gs.length - 8} more`]] : [])]} /> };
  }, [sets, z, spec]);
  return (
    <PlotCanvas zkey={zkey} home={home} draw={draw} hit={hit} lock="x"
      x={{ cats: sets }} y={{ cats: sets }} />
  );
}

// ================================================================== multi-panel
export function MultiPanelPlot({ spec, zkey }: P) {
  const panels: Spec[] = spec.panels ?? [];
  return (
    <div className={panels.length > 2 ? "grid h-full w-full grid-cols-2 grid-rows-2" : "grid h-full w-full grid-cols-2"}>
      {panels.map((p, i) => {
        const R = RENDERERS[p.kind];
        return (
          <div key={i} className="flex min-h-0 min-w-0 flex-col border-seam [&:nth-child(n+3)]:border-t [&:nth-child(2)]:border-l [&:nth-child(4)]:border-l">
            <div className="shrink-0 truncate border-b border-seam px-2 py-0.5 text-2xs text-fg-dim">{p.title}</div>
            <div className="min-h-0 flex-1">{R ? <R spec={p} s={defaults(p)} zkey={`${zkey}:${i}`} /> : null}</div>
          </div>
        );
      })}
    </div>
  );
}

export const RENDERERS: Record<string, (p: P) => React.JSX.Element> = {
  de: DEPlot, embedding: EmbeddingPlot, groups: GroupsPlot, enrichment: EnrichmentPlot,
  heatmap: HeatmapPlot, effects: EffectsPlot, xy: XYPlot, gene: GenePlot,
  histogram: HistogramPlot, dotplot: DotPlotPlot, "overlap-matrix": OverlapPlot, "multi-panel": MultiPanelPlot,
};
