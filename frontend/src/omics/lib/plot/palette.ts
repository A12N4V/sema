// Canvas can't use Tailwind classes, so plots read the resolved CSS tokens,
// as Sema's paint.ts does. The figure colours mirror workflows/bulk-py/utils.py
// (dark theme), so a saved PNG and its interactive twin agree.

export interface Palette {
  bg: string; panel: string; seam: string; seamBright: string;
  fg: string; dim: string; faint: string; accent: string;
  up: string; down: string; ns: string; alert: string; warn: string; good: string;
}

let cache: Palette | null = null;
export function palette(): Palette {
  if (cache) return cache;
  const s = getComputedStyle(document.documentElement);
  const v = (n: string, d: string) => s.getPropertyValue(n).trim() || d;
  cache = {
    bg: v("--color-bg", "#000"), panel: v("--color-panel", "#0a0b0e"),
    seam: v("--color-seam", "#23262e"), seamBright: v("--color-seam-bright", "#363a44"),
    fg: v("--color-fg", "#e8eaee"), dim: v("--color-fg-dim", "#9297a2"), faint: v("--color-fg-faint", "#585d68"),
    accent: v("--color-accent", "#4c9dff"), alert: v("--color-alert", "#e2704c"),
    warn: v("--color-warn", "#d7a63f"), good: v("--color-good", "#4dc07d"),
    up: "#e2704c", down: "#4dc07d", ns: "#3a3e47",
  };
  return cache;
}
matchMedia("(prefers-color-scheme: light)").addEventListener?.("change", () => { cache = null; });

/** Reference group in the ground's dim tone, test group in Okabe-Ito green (the scripts' "green" palette). */
export function groupColor(g: string, order: string[]): string {
  const p = palette();
  const i = order.indexOf(g);
  return i === 0 ? p.dim : i === 1 ? "#009E73" : CATS[(i + 2) % CATS.length];
}

// 20 categorical colours that hold up on black (tableau20-ish, lifted).
export const CATS = [
  "#4c9dff", "#f28e2b", "#59a14f", "#e15759", "#b07aa1", "#76b7b2", "#edc948", "#ff9da7",
  "#9c755f", "#86bcb6", "#a0cbe8", "#ffbe7d", "#8cd17d", "#f1ce63", "#d37295", "#fabfd2",
  "#79706e", "#d4a6c8", "#b6992d", "#499894",
];

/** Sequential (viridis-like, dark-friendly) and diverging (blue–ground–red) ramps. */
const VIRIDIS = ["#440154", "#3b528b", "#21918c", "#5ec962", "#fde725"];
const DIVERGE = ["#2166ac", "#67a9cf", "#16181d", "#ef8a62", "#b2182b"];

function lerpHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const r = (pa >> 16) + ((pb >> 16) - (pa >> 16)) * t;
  const g = ((pa >> 8) & 255) + (((pb >> 8) & 255) - ((pa >> 8) & 255)) * t;
  const bl = (pa & 255) + ((pb & 255) - (pa & 255)) * t;
  return `rgb(${r | 0},${g | 0},${bl | 0})`;
}
export function ramp(t: number, kind: "sequential" | "diverging" = "sequential"): string {
  const stops = kind === "diverging" ? DIVERGE : VIRIDIS;
  if (!Number.isFinite(t)) return palette().seam;
  const x = Math.min(1, Math.max(0, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  return lerpHex(stops[i], stops[i + 1], x - i);
}
