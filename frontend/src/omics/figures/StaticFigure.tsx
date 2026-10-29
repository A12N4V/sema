import { useEffect, useRef, useState } from "react";

/**
 * A saved PNG with the same gestures as the canvas plots: wheel or pinch to
 * zoom about the pointer, drag to pan, double-click to fit. For the figures the
 * scripts wrote that have no interactive twin.
 */
export function StaticFigure({ src, alt, cmd }: { src: string; alt: string; cmd?: { op: string; n: number } | null }) {
  const box = useRef<HTMLDivElement>(null);
  const [t, setT] = useState({ s: 1, x: 0, y: 0 });
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const last = useRef<{ x: number; y: number; d?: number } | null>(null);
  const lastTap = useRef(0);

  useEffect(() => setT({ s: 1, x: 0, y: 0 }), [src]);
  useEffect(() => {
    if (!cmd) return;
    const r = box.current!.getBoundingClientRect();
    if (cmd.op === "reset") setT({ s: 1, x: 0, y: 0 });
    else zoom(r.width / 2, r.height / 2, cmd.op === "in" ? 1.4 : 1 / 1.4);
  }, [cmd]); // eslint-disable-line react-hooks/exhaustive-deps

  const zoom = (cx: number, cy: number, f: number) => setT((o) => {
    const s = Math.min(20, Math.max(1, o.s * f));
    const k = s / o.s;
    return s === 1 ? { s: 1, x: 0, y: 0 } : { s, x: cx - (cx - o.x) * k, y: cy - (cy - o.y) * k };
  });
  useEffect(() => {
    const el = box.current!;
    const w = (e: WheelEvent) => { e.preventDefault(); const r = el.getBoundingClientRect(); zoom(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002))); };
    el.addEventListener("wheel", w, { passive: false });
    return () => el.removeEventListener("wheel", w);
  }, []);
  const loc = (e: React.PointerEvent) => { const r = box.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  return (
    <div ref={box} className="plot-surface thumb relative h-full w-full cursor-grab overflow-hidden active:cursor-grabbing"
      onPointerDown={(e) => {
        box.current!.setPointerCapture(e.pointerId); ptrs.current.set(e.pointerId, loc(e));
        const p = [...ptrs.current.values()];
        last.current = p.length === 2 ? { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2, d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) } : loc(e);
        const now = performance.now(); if (now - lastTap.current < 300) setT({ s: 1, x: 0, y: 0 }); lastTap.current = now;
      }}
      onPointerMove={(e) => {
        if (!ptrs.current.has(e.pointerId) || !last.current) return;
        ptrs.current.set(e.pointerId, loc(e));
        const p = [...ptrs.current.values()];
        if (p.length === 2 && last.current.d) {
          const cx = (p[0].x + p[1].x) / 2, cy = (p[0].y + p[1].y) / 2, d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
          zoom(cx, cy, d / last.current.d);
          setT((o) => ({ ...o, x: o.x + cx - last.current!.x, y: o.y + cy - last.current!.y }));
          last.current = { x: cx, y: cy, d };
        } else {
          const q = loc(e); const dx = q.x - last.current.x, dy = q.y - last.current.y;
          setT((o) => (o.s === 1 ? o : { ...o, x: o.x + dx, y: o.y + dy }));
          last.current = q;
        }
      }}
      onPointerUp={(e) => { ptrs.current.delete(e.pointerId); if (!ptrs.current.size) last.current = null; }}
      onPointerCancel={(e) => { ptrs.current.delete(e.pointerId); last.current = null; }}
    >
      <img src={src} alt={alt} draggable={false}
           className="absolute inset-0 h-full w-full object-contain p-2"
           style={{ transform: `translate(${t.x}px, ${t.y}px) scale(${t.s})`, transformOrigin: "0 0" }} />
      {t.s > 1 && <span className="mono pointer-events-none absolute right-3 top-2 rounded-xs bg-bg/80 px-1.5 text-2xs text-fg-faint">{t.s.toFixed(1)}× · double-click to fit</span>}
    </div>
  );
}
