import { create } from "zustand";
import type { Caps, NounEntry, RunMeta, RunSummary, Value, Workflow, WorkflowId } from "./api";

/**
 * One store. The selected gene is the spine, the way Sema's cursor is: the
 * volcano, the MA, the heatmap rows and the gene panel all read it and any of
 * them can write it, so they never disagree about what you are looking at.
 */
export type Page = "pipeline" | "ledger" | string;           // or a noun id
export type RibbonTab = "run" | "figure" | "export";
export type FigSettings = Record<string, Value>;

const load = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } };
const keep = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private window */ } };

interface State {
  workflows: Workflow[];
  caps: Caps | null;
  wfId: WorkflowId;
  runs: RunSummary[];
  runId: string | null;
  run: RunMeta | null;
  catalogue: NounEntry[];
  edits: Record<string, Record<string, Value>>;           // per workflow
  engine: Record<string, string>;                          // per workflow
  page: Record<string, Page>;                              // per workflow
  focus: Record<string, string>;                           // per noun: "fig:<id>" | "img:<path>" | "tab:<path>"
  variant: Record<string, string>;                         // per figure key
  settings: Record<string, FigSettings>;                   // per figure kind+id
  gene: string | null;
  /** named gene sets, pinned from the volcano brush or the paste box; shared across views */
  geneSets: { name: string; genes: string[]; origin: string }[];
  /** background live jobs, keyed `${runId}:${op}` so a chip survives navigation away */
  jobs: Record<string, { id: string; label: string; status: string; summary?: Record<string, Value> | null; error?: string }>;
  /** a live recompute shown in place of a figure, keyed `${runId}:${figId}` */
  live: Record<string, import("./api").LiveResult>;
  ribbon: { open: boolean; tab: RibbonTab };
  maximized: boolean;
  error: string | null;
  zoomTick: { key: string; op: "in" | "out" | "reset" | "box"; n: number } | null;
  /** the figure in front of you: the ribbon's Figure tab edits this one */
  active: { spec: import("./api").Spec; skey: string; zkey: string } | null;
  palette: null | { mode: "command" } | { mode: "keys" };

  set: (p: Partial<State>) => void;
  setWf: (id: WorkflowId) => void;
  setPage: (p: Page) => void;
  setFocus: (noun: string, f: string) => void;
  setParam: (name: string, v: Value | undefined) => void;
  applyParams: (p: Record<string, Value>) => void;
  resetParams: () => void;
  setSetting: (key: string, k: string, v: Value) => void;
  setVariant: (key: string, v: string) => void;
  setEngine: (e: string) => void;
  zoom: (key: string, op: "in" | "out" | "reset" | "box") => void;
  setRibbon: (p: Partial<State["ribbon"]>) => void;
  setGene: (g: string | null) => void;
  pinSet: (name: string, genes: string[], origin: string) => void;
  dropSet: (name: string) => void;
  setJob: (key: string, v: Partial<State["jobs"][string]> | null) => void;
  setLive: (key: string, v: import("./api").LiveResult | null) => void;
  setPalette: (p: State["palette"]) => void;
}

const same = (a: Value, b: Value) => JSON.stringify(a) === JSON.stringify(b);

/** The selection spine in the URL: #g=<gene>&sets=<n1,n2>. Contents stay in localStorage. */
export const writeHash = (s: { gene: string | null; geneSets: { name: string }[] }) => {
  try {
    const p = new URLSearchParams();
    if (s.gene) p.set("g", s.gene);
    if (s.geneSets.length) p.set("sets", s.geneSets.map((x) => x.name).join(","));
    const next = `#${p.toString()}`;
    if (next !== "#") history.replaceState(null, "", next);
    else if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  } catch { /* no history in some embeds */ }
};

export const useStore = create<State>((set, get) => ({
  workflows: [],
  caps: null,
  wfId: load<WorkflowId>("hodos:wf", "snrna"),
  runs: [],
  runId: null,
  run: null,
  catalogue: [],
  edits: load("hodos:edits", {}),
  engine: load("hodos:engine", {}),
  page: load("hodos:page", {}),
  focus: load("hodos:focus", {}),
  variant: {},
  settings: load("hodos:settings", {}),
  gene: null,
  geneSets: load("hodos:geneSets", [] as State["geneSets"]),
  jobs: {},
  live: {},
  palette: null,
  ribbon: load("hodos:ribbon", { open: true, tab: "run" as RibbonTab }),
  maximized: false,
  error: null,
  zoomTick: null,
  active: null,

  set: (p) => set(p),
  setLive: (key, v) => set((st) => {
    const live = { ...st.live };
    if (v) live[key] = v; else delete live[key];
    return { live };
  }),
  setWf: (id) => { keep("hodos:wf", id); set({ wfId: id, run: null, runId: null, catalogue: [], gene: null, maximized: false }); },
  setPage: (p) => {
    const page = { ...get().page, [get().wfId]: p };
    keep("hodos:page", page);
    const tab: RibbonTab = p === "pipeline" || p === "ledger" ? "run" : "figure";
    const ribbon = { ...get().ribbon, tab };
    set({ page, maximized: false, ribbon });
  },
  setFocus: (noun, f) => { const focus = { ...get().focus, [`${get().wfId}:${noun}`]: f }; keep("hodos:focus", focus); set({ focus }); },
  setParam: (name, v) => {
    const { wfId, workflows, edits } = get();
    const wf = workflows.find((w) => w.id === wfId);
    const next = { ...(edits[wfId] ?? {}) };
    const p = wf?.params.find((q) => q.name === name);
    if (v === undefined || (p && same(v, p.default))) delete next[name]; else next[name] = v;
    const all = { ...edits, [wfId]: next };
    keep("hodos:edits", all); set({ edits: all });
  },
  applyParams: (p) => { for (const [k, v] of Object.entries(p)) get().setParam(k, v); },
  resetParams: () => { const all = { ...get().edits, [get().wfId]: {} }; keep("hodos:edits", all); set({ edits: all }); },
  setSetting: (key, k, v) => {
    const settings = { ...get().settings, [key]: { ...(get().settings[key] ?? {}), [k]: v } };
    keep("hodos:settings", settings); set({ settings });
  },
  setVariant: (key, v) => set({ variant: { ...get().variant, [key]: v } }),
  setEngine: (e) => { const engine = { ...get().engine, [get().wfId]: e }; keep("hodos:engine", engine); set({ engine }); },
  zoom: (key, op) => set({ zoomTick: { key, op, n: (get().zoomTick?.n ?? 0) + 1 } }),
  setRibbon: (p) => { const ribbon = { ...get().ribbon, ...p }; keep("hodos:ribbon", ribbon); set({ ribbon }); },
  setGene: (g) => { set({ gene: g }); writeHash(get()); },
  pinSet: (name, genes, origin) => {
    const trimmed = name.trim() || `set ${get().geneSets.length + 1}`;
    const existing = get().geneSets.filter((s) => s.name !== trimmed);
    const next = [...existing, { name: trimmed, genes, origin }].slice(-12);
    keep("hodos:geneSets", next); set({ geneSets: next }); writeHash(get());
  },
  dropSet: (name) => {
    const next = get().geneSets.filter((s) => s.name !== name);
    keep("hodos:geneSets", next); set({ geneSets: next }); writeHash(get());
  },
  setJob: (key, v) => {
    const jobs = { ...get().jobs };
    if (!v) delete jobs[key]; else jobs[key] = { ...jobs[key], ...v } as State["jobs"][string];
    set({ jobs });
  },
  setPalette: (p) => set({ palette: p }),
}));

/** a stable empty object: a selector that returns a fresh {} loops forever in zustand 5 */
export const NO_EDITS: Record<string, Value> = Object.freeze({}) as Record<string, Value>;

export const useWorkflow = () => useStore((s) => s.workflows.find((w) => w.id === s.wfId));
export const usePage = () => useStore((s) => s.page[s.wfId] ?? "pipeline");
