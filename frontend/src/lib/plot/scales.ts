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

type RGB = [number, number, number];
const hexToRgb = (h: string): RGB => {
  const m = h.replace("#", "");
  const n = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
};
const mix = (a: RGB, b: RGB, k: number): RGB =>
  [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k].map(Math.round) as RGB;

/**
 * Theme-matched heat ramp: t≈0 melts into the panel background, then climbs
 * panel → accent → warn → near-white. Pass hex strings from `paint()`.
 */
export function heat(t: number, panelHex: string, accentHex: string, warnHex: string, fgHex: string): RGB {
  const x = Math.max(0, Math.min(1, t));
  const panel = hexToRgb(panelHex);
  const accent = hexToRgb(accentHex);
  const warn = hexToRgb(warnHex);
  const fg = hexToRgb(fgHex);
  if (x < 0.12) return mix(panel, accent, (x / 0.12) * 0.55);
  if (x < 0.5) return mix(mix(panel, accent, 0.55), accent, (x - 0.12) / 0.38);
  if (x < 0.82) return mix(accent, warn, (x - 0.5) / 0.32);
  return mix(warn, fg, (x - 0.82) / 0.18);
}


/**
 * Diverging ramp for a signed quantity, centred at t = 0.5, in theme colours.
 * (The older `diverging` above takes t in [-1, 1] and hard-codes its colours;
 * this one reads the palette, so it stays right in both themes.)
 *
 * A µV deflection or a dB change against baseline has a meaningful zero and two
 * directions. Drawing it on the sequential `heat` ramp puts zero somewhere in
 * the middle of the blues and makes "no change" look like a value, which is how
 * an ERP image ends up reading as a wall of blue. Cool below, near-transparent
 * at zero, warm above, so the eye finds zero without a legend.
 */
export function divergingTheme(t: number, panelHex: string, coolHex: string, warmHex: string): RGB {
  const x = Math.max(0, Math.min(1, t));
  const panel = hexToRgb(panelHex);
  const cool = hexToRgb(coolHex);
  const warm = hexToRgb(warmHex);
  // eased so small deviations still separate from the neutral middle
  const d = Math.pow(Math.abs(x - 0.5) * 2, 0.7);
  return x < 0.5 ? mix(panel, cool, d) : mix(panel, warm, d);
}
