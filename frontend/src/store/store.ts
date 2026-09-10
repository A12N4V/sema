import { create } from "zustand";
import type { StateCreator } from "zustand";
import { api, type SessionInfo, type LedgerEntry, type MontageLayout, type ContainerRef, type Filmstrip } from "../api/client";
import { applyTheme, readTheme, resolved, type Theme } from "../lib/theme";
import { FRAME_SIZE, nearestFrame, prefetch, setGeneration, type Spec } from "../lib/figures";
import type { Derivation } from "../lib/derivation";
import type { EpochsClock } from "../lib/epochClock";

/* ------------------------------------------------------------------ session */
interface SessionSlice {
  session: SessionInfo | null;
  layout: MontageLayout | null;
  setSession: (s: SessionInfo | null) => void;
  patchSession: (s: SessionInfo) => void;
  loadLayout: () => Promise<void>;
}

const sessionSlice: StateCreator<Store, [], [], SessionSlice> = (set, get) => ({
  session: null,
  layout: null,
  setSession: (session) => {
    set({ session });
    if (session) {
      set({
        // Every channel, not the first sixteen. The waveform pages sixteen at a
        // time and states its range ("1-16 of 64"), and it fetches only the page
        // it is drawing, so a default selection costs nothing to widen. Slicing
        // here made a 64-channel montage report "1-16 of 16", which reads as
        // "this is all of it": the same silent hiding the paging header exists
        // to prevent, moved one level up.
        selectedChannels: session.channel_names,
        windowStart: 0,
        windowDuration: 10,
        t: 5,
        history: [],
        activeContainerId: "raw",
        selectedStep: null,
        maximized: null,
      });
      void get().loadLayout();
      void get().refreshHistory();
      void get().refreshGraph();
    }
    get().syncFigures();
  },
  patchSession: (session) => {
    set({ session });
    // an op may have changed the signal: the cached figures would be of the
    // recording as it was before it
    get().syncFigures();
  },
  loadLayout: async () => {
    const s = get().session;
    if (!s) return;
    try {
      set({ layout: await api.montageLayout(s.session_id) });
    } catch {
      set({ layout: null });
    }
  },
});

/* ------------------------------------------------------------------- cursor */
/** FROZEN CONTRACT: `t` is absolute seconds. The window is where the
 *  waveform is looking; the cursor may sit inside or (briefly) outside it. */
interface CursorSlice {
  t: number;
  windowStart: number;
  windowDuration: number;
  playing: boolean;
  speed: number;
  setCursor: (t: number) => void;
  seekTo: (t: number) => void;
  setWindow: (start: number, duration?: number) => void;
  nudgeCursor: (dt: number) => void;
  pageWindow: (dir: -1 | 1) => void;
  setPlaying: (p: boolean) => void;
  setSpeed: (s: number) => void;
}

const cursorSlice: StateCreator<Store, [], [], CursorSlice> = (set, get) => ({
  t: 0,
  windowStart: 0,
  windowDuration: 10,
  playing: false,
  speed: 1,
  setCursor: (t) => {
    const dur = get().session?.duration_seconds ?? Infinity;
    set({ t: Math.max(0, Math.min(t, dur)) });
  },
  seekTo: (t) => {
    get().setCursor(t);
    const { t: ct, windowStart, windowDuration } = get();
    if (ct < windowStart || ct > windowStart + windowDuration) {
      get().setWindow(ct - windowDuration / 2);
    }
  },
  setWindow: (start, duration) => {
    const total = get().session?.duration_seconds ?? Infinity;
    const d = duration ?? get().windowDuration;
    set({ windowStart: Math.max(0, Math.min(start, Math.max(0, total - d))), windowDuration: d });
  },
  nudgeCursor: (dt) => get().setCursor(get().t + dt),
  pageWindow: (dir) => {
    const { windowStart, windowDuration } = get();
    get().setWindow(windowStart + dir * windowDuration * 0.9);
  },
  setPlaying: (playing) => set({ playing }),
  setSpeed: (speed) => set({ speed }),
});

/* ---------------------------------------------------------------- selection */
interface SelectionSlice {
  selectedChannels: string[];
  focusChannel: string | null;
  component: number | null;
  selectedStep: number | null;
  band: string;
  toggleChannel: (ch: string) => void;
  setSelectedChannels: (c: string[]) => void;
  setFocusChannel: (c: string | null) => void;
  setComponent: (i: number | null) => void;
  setSelectedStep: (seq: number | null) => void;
  setBand: (b: string) => void;
}

const selectionSlice: StateCreator<Store, [], [], SelectionSlice> = (set, get) => ({
  selectedChannels: [],
  focusChannel: null,
  component: null,
  selectedStep: null,
  band: "alpha",
  toggleChannel: (ch) => {
    const cur = get().selectedChannels;
    set({ selectedChannels: cur.includes(ch) ? cur.filter((c) => c !== ch) : [...cur, ch] });
  },
  setSelectedChannels: (selectedChannels) => set({ selectedChannels }),
  setFocusChannel: (focusChannel) => set({ focusChannel, selectedStep: null }),
  setComponent: (component) => set({ component }),
  setSelectedStep: (selectedStep) => set({ selectedStep, focusChannel: null }),
  setBand: (band) => set({ band }),
});

/* ------------------------------------------------------------------- layout */
/** Which pane, if any, is blown up to fill the whole main area. Every pane
 *  keeps its own controls while maximized: this only changes its box. */
interface LayoutSlice {
  maximized: string | null;
  setMaximized: (paneId: string | null) => void;
  toggleMaximized: (paneId: string) => void;
}

const layoutSlice: StateCreator<Store, [], [], LayoutSlice> = (set, get) => ({
  maximized: null,
  setMaximized: (maximized) => set({ maximized }),
  toggleMaximized: (paneId) => set({ maximized: get().maximized === paneId ? null : paneId }),
});

/* ----------------------------------------------------------------- pipeline */
interface PipelineSlice {
  history: LedgerEntry[];
  ledgerHead: number;
  leaves: number[];
  montageName: string | null;
  hasIca: boolean;
  refreshHistory: () => Promise<void>;
}

const pipelineSlice: StateCreator<Store, [], [], PipelineSlice> = (set, get) => ({
  history: [],
  ledgerHead: 0,
  leaves: [],
  montageName: null,
  hasIca: false,
  refreshHistory: async () => {
    const s = get().session;
    if (!s) return;
    try {
      const h = await api.history(s.session_id);
      set({
        history: h.entries,
        ledgerHead: h.head ?? 0,
        leaves: h.leaves ?? [],
        montageName: h.montage_name,
        hasIca: h.has_ica,
      });
    } catch {
      /* ignore */
    }
  },
});

/* ------------------------------------------------------------------- graph */
interface GraphSlice {
  containerGraph: ContainerRef[];
  capabilities: string[];
  /**
   * container id -> the auto-derivation record behind it, for containers this
   * program filled in on its own. Panes read it to show their disclaimer.
   */
  autoDerived: Record<string, Derivation>;
  /**
   * How the epoch clock maps onto the recording clock, or null when there are
   * no trials. Kept here rather than in each pane because Epochs, Evoked and
   * TFR all need the same mapping and would otherwise each refetch it and each
   * drift out of step with the others.
   */
  epochsClock: EpochsClock | null;
  activeContainerId: string;
  refreshGraph: () => Promise<void>;
  setActiveContainer: (id: string) => void;
}

const graphSlice: StateCreator<Store, [], [], GraphSlice> = (set, get) => ({
  containerGraph: [],
  capabilities: [],
  autoDerived: {},
  epochsClock: null,
  activeContainerId: "raw",
  refreshGraph: async () => {
    const s = get().session;
    if (!s) return;
    try {
      const g = await api.graph(s.session_id);
      const active = get().activeContainerId;
      // keep the active id if it's a live node OR a known "prospective" container
      // the user is setting up (e.g. "ica" while the fit wizard is open)
      const prospective = ["ica", "epochs", "source", "spectrum", "tfr"];
      const keep = g.graph.some((n) => n.id === active) || prospective.includes(active);
      set({
        containerGraph: g.graph,
        capabilities: g.capabilities,
        autoDerived: g.auto_derived ?? {},
        activeContainerId: keep ? active : "raw",
      });
      if (g.capabilities.includes("epochs")) {
        const e = await api.epochsSummary(s.session_id);
        if (get().session?.session_id === s.session_id) {
          set({ epochsClock: { onsets: e.onsets ?? [], tmin: e.tmin, tmax: e.tmax } });
        }
      } else {
        set({ epochsClock: null });
      }
    } catch {
      /* ignore */
    }
  },
  setActiveContainer: (activeContainerId) => set({ activeContainerId }),
});

/* ---------------------------------------------------------------- figures */
/**
 * The precomputed figure pass. On load: and after any operation that changes
 * the signal: the server renders the whole recording's topographies, band maps
 * and sensor layout in the background; this slice tracks that and pulls the
 * result into the browser so the timeline and the figures move together.
 */
export type PrepState = "idle" | "running" | "ready" | "blocked" | "error";

interface FiguresSlice {
  filmstrip: Filmstrip | null;
  prepState: PrepState;
  /** 0..1: server render, then client prefetch, as one bar. */
  prepProgress: number;
  prepDetail: string;
  /** Render + cache every figure for the current state. Safe to call repeatedly. */
  prepareFigures: () => Promise<void>;
  /**
   * Called after anything that could invalidate the figures (a new session, an
   * operation, a theme switch). Drops the stale ones and starts a fresh pass -
   * but only when something actually moved, so an unrelated session edit is free.
   */
  syncFigures: () => void;
}

/** Only one pass may be in flight; a newer request supersedes an older one. */
let prepToken = 0;
let figureGeneration = "";

const figuresSlice: StateCreator<Store, [], [], FiguresSlice> = (set, get) => ({
  filmstrip: null,
  prepState: "idle",
  prepProgress: 0,
  prepDetail: "",
  syncFigures: () => {
    const s = get().session;
    if (!s) {
      figureGeneration = "";
      setGeneration("");
      set({ filmstrip: null, prepState: "idle", prepProgress: 0, prepDetail: "" });
      return;
    }
    // exactly the inputs the server's cache key depends on
    const gen = [
      s.session_id, get().resolvedTheme,
      s.highpass, s.lowpass, s.sfreq, s.n_times, s.bads.join(","),
    ].join("|");
    if (gen === figureGeneration) return;
    figureGeneration = gen;
    setGeneration(gen);
    set({ filmstrip: null, prepProgress: 0 });
    void get().prepareFigures();
  },
  prepareFigures: async () => {
    const s = get().session;
    if (!s) return;
    const id = s.session_id;
    const theme = get().resolvedTheme;
    const token = ++prepToken;
    const live = () => token === prepToken && get().session?.session_id === id;

    set({ prepState: "running", prepProgress: 0, prepDetail: "preparing figures" });
    try {
      let film = await api.filmstrip(id, theme, FRAME_SIZE, FRAME_SIZE);
      if (!live()) return;

      if (film.blocked) {
        set({ filmstrip: film, prepState: "blocked", prepDetail: film.blocked, prepProgress: 0 });
        return;
      }

      if (!film.ready) {
        const { job_id } = await api.precompute(id, { theme, width: FRAME_SIZE, height: FRAME_SIZE });
        for (;;) {
          const job = await api.getJob(job_id);
          if (!live()) return;
          // the server pass is the first half of the bar, the prefetch the second
          set({ prepProgress: job.progress * 0.5, prepDetail: job.detail || "rendering figures" });
          if (job.state === "done") break;
          if (job.state === "error") throw new Error(job.error ?? "precompute failed");
          await new Promise((r) => setTimeout(r, 350));
        }
        film = await api.filmstrip(id, theme, FRAME_SIZE, FRAME_SIZE);
        if (!live()) return;
        // The same job also derives the ICA / epochs / evoked / TFR / source
        // views, so half the container strip changes state here. Without this
        // refresh those panes stayed locked until the *next* operation happened
        // to refetch the graph, which on a fresh session is never: the work was
        // done and sitting on the server behind a padlock.
        void get().refreshGraph();
      }
      set({ filmstrip: film });

      const specs: Spec[] = [
        { view: "sensors", width: FRAME_SIZE, height: FRAME_SIZE, theme },
        ...film.bands.map((band) => ({
          view: "topomap", source: "band", band, width: FRAME_SIZE, height: FRAME_SIZE, theme,
        })),
        ...film.times.map((t) => ({
          view: "topomap", source: "cursor", t, width: FRAME_SIZE, height: FRAME_SIZE, theme,
        })),
      ];
      await prefetch(id, specs, (f) => {
        if (live()) set({ prepProgress: 0.5 + f * 0.5, prepDetail: "loading frames" });
      });
      if (!live()) return;
      set({ prepState: "ready", prepProgress: 1, prepDetail: `${film.times.length} frames` });
    } catch (e) {
      if (live()) set({ prepState: "error", prepDetail: (e as Error).message });
    }
  },
});

/** The frame-grid time nearest the cursor: what a scrub can paint instantly. */
export const useNearestFrame = (): number =>
  useStore((s) => nearestFrame(s.filmstrip?.times ?? [], s.t));

/* ------------------------------------------------------------------ settings */
interface SettingsSlice {
  theme: Theme;
  resolvedTheme: "light" | "dark";
  /** bumped whenever the effective theme changes: canvas panels key repaints off it */
  themeTick: number;
  settingsOpen: boolean;
  paletteOpen: boolean;
  /** Set when a toolbar shortcut opens the palette straight into one op's
   *  form (skips the search list). Cleared whenever the palette closes. */
  paletteOpId: string | null;
  setTheme: (t: Theme) => void;
  syncSystemTheme: () => void;
  setSettingsOpen: (open: boolean) => void;
  setPaletteOpen: (open: boolean) => void;
  /** Open the palette pre-selected to one operation: the toolbar's one-click path. */
  openOp: (opId: string) => void;
}

const settingsSlice: StateCreator<Store, [], [], SettingsSlice> = (set, get) => {
  const initial = readTheme();
  return {
    theme: initial,
    resolvedTheme: resolved(initial),
    themeTick: 0,
    settingsOpen: false,
    paletteOpen: false,
    paletteOpId: null,
    setTheme: (theme) => {
      const resolvedTheme = applyTheme(theme);
      set({ theme, resolvedTheme, themeTick: get().themeTick + 1 });
      get().syncFigures();   // figures are drawn in the theme's ink
    },
    syncSystemTheme: () => {
      if (get().theme !== "system") return;
      const resolvedTheme = resolved("system");
      if (resolvedTheme !== get().resolvedTheme) {
        set({ resolvedTheme, themeTick: get().themeTick + 1 });
        get().syncFigures();
      }
    },
    setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
    setPaletteOpen: (paletteOpen) => set({ paletteOpen, ...(paletteOpen ? {} : { paletteOpId: null }) }),
    openOp: (paletteOpId) => set({ paletteOpen: true, paletteOpId }),
  };
};

/* -------------------------------------------------------------------- store */
export type Store = SessionSlice & CursorSlice & SelectionSlice & LayoutSlice &
  PipelineSlice & GraphSlice & FiguresSlice & SettingsSlice;

export const useStore = create<Store>()((...a) => ({
  ...sessionSlice(...a),
  ...cursorSlice(...a),
  ...selectionSlice(...a),
  ...layoutSlice(...a),
  ...pipelineSlice(...a),
  ...graphSlice(...a),
  ...figuresSlice(...a),
  ...settingsSlice(...a),
}));

/** Non-reactive accessor for command handlers. */
export const store = () => useStore.getState();
