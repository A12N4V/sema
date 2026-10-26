import type { Spec, Value } from "../api";

/**
 * What can be changed on each kind of figure. One declaration per kind, read
 * by both the ribbon's Figure tab and the gear popover on the card, so a
 * setting exists in exactly one place however you reach it (Sema's rule:
 * parameters on the surface, declared once).
 */
export type Control =
  | { key: string; label: string; type: "select"; options: (spec: Spec) => { value: string; label: string }[] }
  | { key: string; label: string; type: "number"; step: number; min?: number; max?: number }
  | { key: string; label: string; type: "toggle" };

const opt = (...v: string[]) => () => v.map((x) => ({ value: x, label: x }));

export const CONTROLS: Record<string, Control[]> = {
  de: [
    { key: "view", label: "View", type: "select", options: opt("volcano", "MA") },
    { key: "y", label: "Y", type: "select", options: opt("padj", "p") },
    { key: "fdr", label: "FDR", type: "number", step: 0.01, min: 0.0001, max: 1 },
    { key: "lfc", label: "|log2FC| ≥", type: "number", step: 0.05, min: 0, max: 10 },
    { key: "labels", label: "Labels", type: "number", step: 1, min: 0, max: 60 },
    { key: "size", label: "Point", type: "number", step: 0.5, min: 0.5, max: 8 },
  ],
  embedding: [
    { key: "colorBy", label: "Colour", type: "select", options: (s) => Object.keys(s.color ?? {}).map((k) => ({ value: k, label: k })) },
    { key: "x", label: "X", type: "select", options: (s) => Object.keys(s.axes ?? {}).map((k) => ({ value: k, label: k })) },
    { key: "y", label: "Y", type: "select", options: (s) => Object.keys(s.axes ?? {}).map((k) => ({ value: k, label: k })) },
    { key: "size", label: "Point", type: "number", step: 0.5, min: 0.5, max: 12 },
    { key: "alpha", label: "Opacity", type: "number", step: 0.1, min: 0.05, max: 1 },
    { key: "labels", label: "Names", type: "toggle" },
  ],
  groups: [
    { key: "metric", label: "Metric", type: "select", options: (s) => Object.entries(s.metrics ?? {}).map(([k, m]) => ({ value: k, label: (m as { label: string }).label })) },
    { key: "mode", label: "Mark", type: "select", options: opt("bars", "box", "violin", "points") },
    { key: "log", label: "Log y", type: "toggle" },
    { key: "points", label: "Points", type: "toggle" },
  ],
  enrichment: [
    { key: "fdr", label: "FDR", type: "number", step: 0.01, min: 0.0001, max: 1 },
    { key: "top", label: "Top", type: "number", step: 1, min: 3, max: 200 },
    { key: "set", label: "Set", type: "select", options: (s) => [{ value: "all", label: "all" }, ...[...new Set<string>(s.set ?? [])].map((x) => ({ value: x, label: x }))] },
    { key: "sort", label: "Sort", type: "select", options: opt("score", "padj") },
  ],
  heatmap: [
    { key: "clip", label: "Clip ±", type: "number", step: 0.5, min: 0.5, max: 10 },
    { key: "values", label: "Values", type: "toggle" },
  ],
  effects: [{ key: "sort", label: "Sort", type: "select", options: opt("estimate", "label") }],
  xy: [
    { key: "size", label: "Point", type: "number", step: 0.5, min: 0.5, max: 10 },
    { key: "diag", label: "y = x", type: "toggle" },
  ],
  gene: [{ key: "labels", label: "Names", type: "toggle" }],
  histogram: [{ key: "log", label: "Log y", type: "toggle" }],
  dotplot: [
    { key: "per", label: "Markers/cluster", type: "number", step: 1, min: 3, max: 12 },
    { key: "sizeMax", label: "Dot size", type: "number", step: 2, min: 4, max: 24 },
  ],
  "overlap-matrix": [{ key: "values", label: "Values", type: "toggle" }],
  "multi-panel": [],
};

export function defaults(spec: Spec): Record<string, Value> {
  switch (spec.kind) {
    case "de": return { view: "volcano", y: "padj", fdr: spec.defaults?.fdr ?? 0.05, lfc: spec.defaults?.lfc ?? 0.3, labels: 12, size: 2 };
    case "embedding": return { colorBy: spec.colorBy ?? "", x: spec.x, y: spec.y, size: spec.pointSize ?? 3, alpha: spec.label ? 1 : 0.6, labels: !!spec.label };
    case "groups": return { metric: Object.keys(spec.metrics ?? {})[0] ?? "", mode: spec.mode ?? "box", log: false, points: true };
    case "enrichment": return { fdr: spec.defaults?.fdr ?? 0.05, top: spec.defaults?.top ?? 15, set: "all", sort: "score" };
    case "heatmap": return { clip: spec.scale === "diverging" ? 2.5 : 1, values: !!spec.annotate };
    case "effects": return { sort: "estimate" };
    case "xy": return { size: 3, diag: !!spec.diag };
    case "gene": return { labels: true };
    case "histogram": return { log: false };
    case "dotplot": return { per: 6, sizeMax: 14 };
    case "overlap-matrix": return { values: false };
    case "multi-panel": return {};
    default: return {};
  }
}
