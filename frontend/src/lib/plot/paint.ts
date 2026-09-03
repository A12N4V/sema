// Canvas panels can't use Tailwind classes, so they read the resolved theme
// colours from the CSS custom properties once per theme change. Call
// `paint()` inside a draw fn; include the store's `themeTick` in useCanvas
// deps so the canvas repaints when the theme flips.

export interface Palette {
  bg: string;
  panel: string;
  grid: string;        // faint interior grid lines
  gridStrong: string;  // axis frame / separators
  seam: string;
  text: string;        // primary labels
  textDim: string;     // secondary labels
  textFaint: string;   // tick labels
  trace: string;       // default waveform / series stroke
  accent: string;
  accentSoft: string;  // translucent accent fill
  cursor: string;      // shared time cursor
  alert: string;
  warn: string;
  good: string;
}

let cache: Palette | null = null;
let cacheKey = -1;

function readVar(styles: CSSStyleDeclaration, name: string, fallback: string): string {
  const v = styles.getPropertyValue(name).trim();
  return v || fallback;
}

/** Resolved palette for the current theme. Pass the store's themeTick to bust the cache. */
export function paint(themeTick = 0): Palette {
  if (cache && cacheKey === themeTick) return cache;
  const s = getComputedStyle(document.documentElement);
  const accent = readVar(s, "--color-accent", "#4c9dff");
  cache = {
    bg: readVar(s, "--color-bg", "#0a0b0d"),
    panel: readVar(s, "--color-panel", "#101216"),
    grid: readVar(s, "--color-seam", "#23262d"),
    gridStrong: readVar(s, "--color-seam-bright", "#343842"),
    seam: readVar(s, "--color-seam", "#23262d"),
    text: readVar(s, "--color-fg", "#e6e8ec"),
    textDim: readVar(s, "--color-fg-dim", "#969ba5"),
    textFaint: readVar(s, "--color-fg-faint", "#5c616c"),
    trace: readVar(s, "--color-fg-dim", "#969ba5"),
    accent,
    accentSoft: `color-mix(in srgb, ${accent} 14%, transparent)`,
    cursor: readVar(s, "--color-alert", "#e2704c"),
    alert: readVar(s, "--color-alert", "#e2704c"),
    warn: readVar(s, "--color-warn", "#d7a63f"),
    good: readVar(s, "--color-good", "#4dc07d"),
  };
  cacheKey = themeTick;
  return cache;
}
