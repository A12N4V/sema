import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { palette } from "./palette";
import { fmt, makeView, ticks, type Domain, type View } from "./scales";
import { useStore } from "../../store";
import { useStore as useShell } from "../../../store/store";

/**
 * The one canvas every interactive figure draws on. It owns sizing, the zoom
 * and pan gestures, axes, and the hover tooltip; a figure supplies only its
 * home domain, a draw function and a hit test. That split is what lets eight
 * figure kinds share one interaction model, so zooming a volcano and zooming a
 * heatmap feel the same.
 *
 *   wheel / trackpad pinch   zoom about the pointer (shift: x only, alt: y only)
 *   drag                     pan
 *   two fingers              pinch-zoom and pan
 *   double click / tap       back to the whole data
 *   box mode (header button) drag a rectangle to zoom into it
 */
export interface Axis {
  label?: string;
  /** categorical labels at integer positions, instead of numeric ticks */
  cats?: string[];
  /** a value transform for tick labels, e.g. 10^x for a log axis */
  tickFmt?: (v: number) => string;
  hidden?: boolean;
}
export interface Hit { x: number; y: number; html: ReactNode; key?: string }

interface Props {
  zkey: string;                      // identifies this plot for zoom commands from the header
  home: Domain;
  draw: (ctx: CanvasRenderingContext2D, v: View) => void;
  hit?: (px: number, py: number, v: View) => Hit | null;
  onPick?: (h: Hit) => void;
  x?: Axis; y?: Axis;
  margin?: Partial<{ l: number; r: number; t: number; b: number }>;
  lock?: "x" | "y";                  // keep one axis at home (e.g. a category axis that must stay whole)
  /**
   * Take over single-pointer drags (a threshold line, a band). When set, a
   * one-pointer drag calls this instead of panning; zoom and box still work.
   */
  drag?: (v: View, px: number, py: number, phase: "start" | "move" | "end") => void;
}

const clampDomain = (d: Domain, home: Domain): Domain => {
  // never zoom out past 3× the home span, never into nothing
  const hx = home.x1 - home.x0, hy = home.y1 - home.y0;
  let { x0, x1, y0, y1 } = d;
  if (x1 - x0 > hx * 3) { const c = (x0 + x1) / 2; x0 = c - hx * 1.5; x1 = c + hx * 1.5; }
  if (y1 - y0 > hy * 3) { const c = (y0 + y1) / 2; y0 = c - hy * 1.5; y1 = c + hy * 1.5; }
  if (x1 - x0 < hx * 1e-6) x1 = x0 + hx * 1e-6;
  if (y1 - y0 < hy * 1e-6) y1 = y0 + hy * 1e-6;
  return { x0, x1, y0, y1 };
};

export function PlotCanvas({ zkey, home, draw, hit, onPick, x, y, margin, lock, drag }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [dom, setDom] = useState<Domain>(home);
  const [tip, setTip] = useState<Hit | null>(null);
  const [box, setBox] = useState<{ a: [number, number]; b: [number, number] } | null>(null);
  const [boxMode, setBoxMode] = useState(false);
  const zoomTick = useStore((s) => s.zoomTick);
  const themeTick = useShell((s) => s.themeTick);   // repaint in the new ink
  const homeKey = `${home.x0},${home.x1},${home.y0},${home.y1}`;

  // a new home (new data, new settings) resets the view
  useEffect(() => { setDom(home); }, [homeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    const el = wrap.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.floor(e.contentRect.width), h: Math.floor(e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const m = { l: y?.hidden ? 8 : y?.cats ? 150 : 52, r: 14, t: 10, b: x?.hidden ? 8 : x?.cats ? 64 : 38, ...margin };
  if (size.w < 420 && y?.cats) m.l = Math.min(m.l, 96);
  const view = useMemo(() => makeView(dom, m.l, m.t, Math.max(10, size.w - m.l - m.r), Math.max(10, size.h - m.t - m.b)),
    [dom, size.w, size.h, m.l, m.r, m.t, m.b]);

  // paint synchronously on every change (rAF is throttled in background tabs)
  useLayoutEffect(() => {
    const c = cv.current; if (!c || !size.w || !size.h) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = size.w * dpr; c.height = size.h * dpr;
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    const p = palette();
    ctx.font = "10px 'JetBrains Mono', ui-monospace, monospace";
    // grid + axes
    ctx.strokeStyle = p.seam; ctx.lineWidth = 1; ctx.fillStyle = p.faint;
    if (!x?.hidden) {
      if (x?.cats) {
        const lo = Math.max(0, Math.ceil(view.x0)), hi = Math.min(x.cats.length - 1, Math.floor(view.x1));
        const every = Math.max(1, Math.ceil((hi - lo + 1) / Math.max(1, view.w / 14)));
        ctx.save(); ctx.textAlign = "right"; ctx.textBaseline = "middle";
        for (let i = lo; i <= hi; i += every) {
          const px = view.px(i);
          ctx.save(); ctx.translate(px, view.t + view.h + 6); ctx.rotate(-Math.PI / 4);
          ctx.fillText(trunc(x.cats[i], 14), 0, 0); ctx.restore();
        }
        ctx.restore();
      } else {
        ctx.textAlign = "center"; ctx.textBaseline = "top";
        for (const tv of ticks(view.x0, view.x1, Math.max(2, Math.floor(view.w / 80)))) {
          const px = Math.round(view.px(tv)) + 0.5;
          ctx.beginPath(); ctx.moveTo(px, view.t); ctx.lineTo(px, view.t + view.h); ctx.stroke();
          ctx.fillText((x?.tickFmt ?? fmt)(tv), px, view.t + view.h + 5);
        }
      }
      if (x?.label) { ctx.fillStyle = p.dim; ctx.textAlign = "center"; ctx.textBaseline = "bottom"; ctx.fillText(x.label, view.l + view.w / 2, size.h - 2); }
    }
    ctx.fillStyle = p.faint;
    if (!y?.hidden) {
      if (y?.cats) {
        const lo = Math.max(0, Math.ceil(view.y0)), hi = Math.min(y.cats.length - 1, Math.floor(view.y1));
        const every = Math.max(1, Math.ceil((hi - lo + 1) / Math.max(1, view.h / 12)));
        ctx.textAlign = "right"; ctx.textBaseline = "middle";
        for (let i = lo; i <= hi; i += every) ctx.fillText(trunc(y.cats[i], Math.floor((m.l - 8) / 6)), view.l - 6, view.py(i));
      } else {
        ctx.textAlign = "right"; ctx.textBaseline = "middle";
        for (const tv of ticks(view.y0, view.y1, Math.max(2, Math.floor(view.h / 50)))) {
          const py = Math.round(view.py(tv)) + 0.5;
          ctx.beginPath(); ctx.moveTo(view.l, py); ctx.lineTo(view.l + view.w, py); ctx.stroke();
          ctx.fillText((y?.tickFmt ?? fmt)(tv), view.l - 6, py);
        }
      }
      if (y?.label) {
        ctx.save(); ctx.fillStyle = p.dim; ctx.translate(10, view.t + view.h / 2); ctx.rotate(-Math.PI / 2);
        ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillText(y.label, 0, -8); ctx.restore();
      }
    }
    ctx.save();
    ctx.beginPath(); ctx.rect(view.l, view.t, view.w, view.h); ctx.clip();
    draw(ctx, view);
    ctx.restore();
    ctx.strokeStyle = p.seamBright; ctx.strokeRect(view.l + 0.5, view.t + 0.5, view.w - 1, view.h - 1);
  }, [view, draw, size, x, y, m.l, themeTick]);

  // ---- gestures
  const zoomAt = useCallback((px: number, py: number, f: number, axes: "xy" | "x" | "y" = "xy") => {
    setDom((d) => {
      const v = makeView(d, view.l, view.t, view.w, view.h);
      const cx = v.ix(px), cy = v.iy(py);
      const zx = axes !== "y" && lock !== "x", zy = axes !== "x" && lock !== "y";
      return clampDomain({
        x0: zx ? cx - (cx - d.x0) * f : d.x0, x1: zx ? cx + (d.x1 - cx) * f : d.x1,
        y0: zy ? cy - (cy - d.y0) * f : d.y0, y1: zy ? cy + (d.y1 - cy) * f : d.y1,
      }, home);
    });
  }, [view.l, view.t, view.w, view.h, home, lock]);

  useEffect(() => {
    const c = cv.current; if (!c) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      const f = Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0022));
      zoomAt(e.clientX - r.left, e.clientY - r.top, f, e.shiftKey ? "x" : e.altKey ? "y" : "xy");
    };
    c.addEventListener("wheel", onWheel, { passive: false });
    return () => c.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  useEffect(() => {
    if (!zoomTick || zoomTick.key !== zkey) return;
    if (zoomTick.op === "reset") setDom(home);
    else if (zoomTick.op === "box") setBoxMode((b) => !b);
    else zoomAt(view.l + view.w / 2, view.t + view.h / 2, zoomTick.op === "in" ? 0.7 : 1 / 0.7);
  }, [zoomTick]); // eslint-disable-line react-hooks/exhaustive-deps

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const last = useRef<{ x: number; y: number; dist?: number; moved: number } | null>(null);
  const lastTap = useRef(0);

  const local = (e: React.PointerEvent) => { const r = cv.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  const onDown = (e: React.PointerEvent) => {
    cv.current!.setPointerCapture(e.pointerId);
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    if (boxMode && pointers.current.size === 1) { setBox({ a: [p.x, p.y], b: [p.x, p.y] }); return; }
    const pts = [...pointers.current.values()];
    last.current = pts.length === 2
      ? { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2, dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), moved: 0 }
      : { x: p.x, y: p.y, moved: 0 };
  };
  const onMove = (e: React.PointerEvent) => {
    const p = local(e);
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, p);
    if (box) { setBox({ ...box, b: [p.x, p.y] }); return; }
    const L = last.current;
    if (L && pointers.current.size) {
      const pts = [...pointers.current.values()];
      if (pts.length === 2 && L.dist) {
        const cx = (pts[0].x + pts[1].x) / 2, cy = (pts[0].y + pts[1].y) / 2;
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        zoomAt(cx, cy, L.dist / Math.max(1, dist));
        pan(cx - L.x, cy - L.y);
        last.current = { x: cx, y: cy, dist, moved: L.moved + 10 };
      } else if (pts.length === 1) {
        if (drag && !L.dist) drag(view, p.x, p.y, L.moved === 0 ? "start" : "move");
        else pan(p.x - L.x, p.y - L.y);
        last.current = { x: p.x, y: p.y, moved: L.moved + Math.abs(p.x - L.x) + Math.abs(p.y - L.y) };
      }
      setTip(null);
      return;
    }
    if (hit && p.x >= view.l && p.x <= view.l + view.w && p.y >= view.t && p.y <= view.t + view.h) setTip(hit(p.x, p.y, view));
    else setTip(null);
  };
  const onUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (box) {
      const [ax, ay] = box.a, [bx, by] = box.b;
      if (Math.abs(ax - bx) > 6 && Math.abs(ay - by) > 6) {
        setDom(clampDomain({
          x0: lock === "x" ? dom.x0 : view.ix(Math.min(ax, bx)), x1: lock === "x" ? dom.x1 : view.ix(Math.max(ax, bx)),
          y0: lock === "y" ? dom.y0 : view.iy(Math.max(ay, by)), y1: lock === "y" ? dom.y1 : view.iy(Math.min(ay, by)),
        }, home));
      }
      setBox(null); setBoxMode(false); return;
    }
    const L = last.current;
    if (!pointers.current.size) last.current = null;
    if (drag && L && !L.dist && L.moved >= 4) drag(view, local(e).x, local(e).y, "end");
    if (L && L.moved < 4 && !L.dist) {
      const now = performance.now();
      if (now - lastTap.current < 300) { setDom(home); lastTap.current = 0; return; }
      lastTap.current = now;
      const p = local(e);
      const h = hit?.(p.x, p.y, view);
      if (h && onPick) onPick(h);
      if (e.pointerType !== "mouse") setTip(h ?? null);
    }
  };
  const pan = (dx: number, dy: number) => setDom((d) => {
    const sx = (d.x1 - d.x0) / view.w, sy = (d.y1 - d.y0) / view.h;
    const mx = lock === "x" ? 0 : dx * sx, my = lock === "y" ? 0 : dy * sy;
    return { x0: d.x0 - mx, x1: d.x1 - mx, y0: d.y0 + my, y1: d.y1 + my };
  });

  const zoomed = dom.x0 !== home.x0 || dom.x1 !== home.x1 || dom.y0 !== home.y0 || dom.y1 !== home.y1;

  return (
    <div ref={wrap} className="relative h-full w-full overflow-hidden">
      <canvas
        ref={cv} className="plot-surface absolute inset-0 h-full w-full"
        style={{ cursor: boxMode ? "crosshair" : pointers.current.size ? "grabbing" : "grab" }}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        onPointerLeave={() => { if (!pointers.current.size) setTip(null); }}
      />
      {box && (
        <div className="pointer-events-none absolute border border-accent bg-accent/10"
             style={{ left: Math.min(box.a[0], box.b[0]), top: Math.min(box.a[1], box.b[1]),
                      width: Math.abs(box.a[0] - box.b[0]), height: Math.abs(box.a[1] - box.b[1]) }} />
      )}
      {tip && (
        <div className="pop pointer-events-none absolute z-10 max-w-64 px-2 py-1.5 text-xs"
             style={{ left: Math.min(tip.x + 12, size.w - 200), top: Math.max(4, tip.y - 8) }}>
          {tip.html}
        </div>
      )}
      {(zoomed || boxMode) && (
        <span className="mono pointer-events-none absolute right-3 top-2 rounded-xs bg-bg/80 px-1.5 text-2xs text-fg-faint">
          {boxMode ? "drag a box" : "zoomed · double-click to reset"}
        </span>
      )}
    </div>
  );
}

const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, Math.max(1, n - 1)) + "…" : s);
