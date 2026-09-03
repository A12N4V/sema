import { useEffect, useLayoutEffect, useRef } from "react";

export interface CanvasCtx {
  ctx: CanvasRenderingContext2D;
  width: number;   // CSS pixels
  height: number;  // CSS pixels
}

/**
 * A canvas that tracks its own rendered size + devicePixelRatio and calls
 * `draw` on resize and whenever `deps` change. Paints synchronously (works
 * even when rAF is throttled, e.g. a background tab).
 */
export function useCanvas(draw: (c: CanvasCtx) => void, deps: unknown[]) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawRef = useRef(draw);
  drawRef.current = draw;

  const paint = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width || canvas.parentElement?.clientWidth || 0;
    const h = rect.height || canvas.parentElement?.clientHeight || 0;
    if (w < 2 || h < 2) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const bw = Math.round(w * dpr);
    const bh = Math.round(h * dpr);
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    drawRef.current({ ctx, width: w, height: h });
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => paint());
    ro.observe(canvas);
    if (canvas.parentElement) ro.observe(canvas.parentElement);
    // catch late layout / font settling / first-mount races
    const raf = requestAnimationFrame(paint);
    const t1 = setTimeout(paint, 50);
    const t2 = setTimeout(paint, 250);
    const t3 = setTimeout(paint, 700);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(paint, deps);

  return canvasRef;
}
