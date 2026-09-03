export type Scale = (v: number) => number;

/** Linear map from `domain` to `range`. */
export function linScale([d0, d1]: [number, number], [r0, r1]: [number, number]): Scale {
  const m = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  return (v) => r0 + (v - d0) * m;
}

export function invLinScale([d0, d1]: [number, number], [r0, r1]: [number, number]): Scale {
  const m = r1 === r0 ? 0 : (d1 - d0) / (r1 - r0);
  return (p) => d0 + (p - r0) * m;
}

/** "Nice" evenly-spaced ticks across [lo, hi]. */
export function ticks(lo: number, hi: number, count = 6): number[] {
  if (!isFinite(lo) || !isFinite(hi) || lo === hi) return [lo];
  const span = hi - lo;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const norm = step0 / mag;
  const step = (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * mag;
  const start = Math.ceil(lo / step) * step;
  const out: number[] = [];
  for (let v = start; v <= hi + step * 1e-6; v += step) out.push(Math.round(v / step) * step);
  return out;
}

export function fmtTime(s: number): string {
  if (s < 60) return `${s.toFixed(s < 10 ? 2 : 1)}s`;
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r.toFixed(0).padStart(2, "0")}`;
}

/** Diverging blue→black→orange colormap for field / topomap values, t in [-1,1]. */
export function diverging(t: number): [number, number, number] {
  const x = Math.max(-1, Math.min(1, t));
  if (x < 0) {
    const k = -x;
    return [Math.round(20 * (1 - k)), Math.round(90 + 90 * (1 - k) * k), Math.round(70 + 185 * k)];
  }
  const k = x;
  return [Math.round(60 + 195 * k), Math.round(70 + 60 * (1 - k)), Math.round(50 * (1 - k))];
}

/** Sequential "inferno-ish" ramp for heatmaps, t in [0,1]. */
export function magma(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t));
  const r = Math.round(255 * Math.min(1, 1.4 * x));
  const g = Math.round(255 * Math.max(0, Math.min(1, 1.3 * x - 0.35)));
  const b = Math.round(255 * (0.35 * Math.sin(Math.PI * x) + 0.9 * Math.pow(x, 3)));
  return [r, g, b];
}

export const rgb = ([r, g, b]: [number, number, number]) => `rgb(${r},${g},${b})`;
