export interface Domain { x0: number; x1: number; y0: number; y1: number }

export interface View extends Domain {
  /** plot rectangle in CSS px */
  l: number; t: number; w: number; h: number;
  px: (x: number) => number;
  py: (y: number) => number;
  ix: (px: number) => number;
  iy: (py: number) => number;
}

export function makeView(d: Domain, l: number, t: number, w: number, h: number): View {
  const sx = w / (d.x1 - d.x0 || 1), sy = h / (d.y1 - d.y0 || 1);
  return {
    ...d, l, t, w, h,
    px: (x) => l + (x - d.x0) * sx,
    py: (y) => t + h - (y - d.y0) * sy,
    ix: (p) => d.x0 + (p - l) / sx,
    iy: (p) => d.y0 + (t + h - p) / sy,
  };
}

/** Round tick values covering [a, b], about n of them. */
export function ticks(a: number, b: number, n = 6): number[] {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return [a];
  const span = Math.abs(b - a), raw = span / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= n) ?? 10 * mag;
  const lo = Math.ceil(Math.min(a, b) / step) * step;
  const out: number[] = [];
  for (let v = lo; v <= Math.max(a, b) + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}

export const fmt = (v: number) => {
  const a = Math.abs(v);
  if (a === 0) return "0";
  if (a >= 1e5 || a < 1e-3) return v.toExponential(0);
  if (a >= 100) return v.toFixed(0);
  if (a >= 1) return String(+v.toFixed(2));
  return String(+v.toPrecision(2));
};

/** Data extent with a margin, ignoring nulls. */
export function extent(vals: (number | null)[], pad = 0.05): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (const v of vals) if (v != null && Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
  if (!Number.isFinite(lo)) return [0, 1];
  if (lo === hi) { lo -= 1; hi += 1; }
  const m = (hi - lo) * pad;
  return [lo - m, hi + m];
}
