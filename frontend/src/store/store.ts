import { create } from "zustand";
import type { StateCreator } from "zustand";
import { api, type SessionInfo, type LedgerEntry, type MontageLayout } from "../api/client";
import { applyTheme, readTheme, resolved, type Theme } from "../lib/theme";

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
        selectedChannels: session.channel_names.slice(0, 16),
        windowStart: 0,
        windowDuration: 10,
        t: 5,
        history: [],
      });
      void get().loadLayout();
      void get().refreshHistory();
    }
  },
  patchSession: (session) => set({ session }),
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
  setCursor: (t: number) => void;
  seekTo: (t: number) => void;
  setWindow: (start: number, duration?: number) => void;
  nudgeCursor: (dt: number) => void;
  pageWindow: (dir: -1 | 1) => void;
  setPlaying: (p: boolean) => void;
}

const cursorSlice: StateCreator<Store, [], [], CursorSlice> = (set, get) => ({
  t: 0,
  windowStart: 0,
  windowDuration: 10,
  playing: false,
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
});

/* ---------------------------------------------------------------- selection */
interface SelectionSlice {
  selectedChannels: string[];
  focusChannel: string | null;
  component: number | null;
  band: string;
  toggleChannel: (ch: string) => void;
  setSelectedChannels: (c: string[]) => void;
  setFocusChannel: (c: string | null) => void;
  setComponent: (i: number | null) => void;
  setBand: (b: string) => void;
}

const selectionSlice: StateCreator<Store, [], [], SelectionSlice> = (set, get) => ({
  selectedChannels: [],
  focusChannel: null,
  component: null,
  band: "alpha",
  toggleChannel: (ch) => {
    const cur = get().selectedChannels;
    set({ selectedChannels: cur.includes(ch) ? cur.filter((c) => c !== ch) : [...cur, ch] });
  },
  setSelectedChannels: (selectedChannels) => set({ selectedChannels }),
  setFocusChannel: (focusChannel) => set({ focusChannel }),
  setComponent: (component) => set({ component }),
  setBand: (band) => set({ band }),
});

/* ------------------------------------------------------------------- layout */
export type WorkspacePreset = "terminal" | "clean" | "report";
interface LayoutSlice {
  preset: WorkspacePreset;
  focusedPanel: string | null;
  setPreset: (p: WorkspacePreset) => void;
  focusPanel: (id: string | null) => void;
}

const layoutSlice: StateCreator<Store, [], [], LayoutSlice> = (set) => ({
  preset: "terminal",
  focusedPanel: null,
  setPreset: (preset) => set({ preset }),
  focusPanel: (focusedPanel) => set({ focusedPanel }),
});

/* ----------------------------------------------------------------- pipeline */
interface PipelineSlice {
  history: LedgerEntry[];
  montageName: string | null;
  hasIca: boolean;
  refreshHistory: () => Promise<void>;
}

const pipelineSlice: StateCreator<Store, [], [], PipelineSlice> = (set, get) => ({
  history: [],
  montageName: null,
  hasIca: false,
  refreshHistory: async () => {
    const s = get().session;
    if (!s) return;
    try {
      const h = await api.history(s.session_id);
      set({ history: h.entries, montageName: h.montage_name, hasIca: h.has_ica });
    } catch {
      /* ignore */
    }
  },
});

/* ------------------------------------------------------------------ settings */
interface SettingsSlice {
  theme: Theme;
  resolvedTheme: "light" | "dark";
  /** bumped whenever the effective theme changes — canvas panels key repaints off it */
  themeTick: number;
  settingsOpen: boolean;
  paletteOpen: boolean;
  setTheme: (t: Theme) => void;
  syncSystemTheme: () => void;
  setSettingsOpen: (open: boolean) => void;
  setPaletteOpen: (open: boolean) => void;
}

const settingsSlice: StateCreator<Store, [], [], SettingsSlice> = (set, get) => {
  const initial = readTheme();
  return {
    theme: initial,
    resolvedTheme: resolved(initial),
    themeTick: 0,
    settingsOpen: false,
    paletteOpen: false,
    setTheme: (theme) => {
      const resolvedTheme = applyTheme(theme);
      set({ theme, resolvedTheme, themeTick: get().themeTick + 1 });
    },
    syncSystemTheme: () => {
      if (get().theme !== "system") return;
      const resolvedTheme = resolved("system");
      if (resolvedTheme !== get().resolvedTheme) set({ resolvedTheme, themeTick: get().themeTick + 1 });
    },
    setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
    setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  };
};

/* -------------------------------------------------------------------- store */
export type Store = SessionSlice & CursorSlice & SelectionSlice & LayoutSlice & PipelineSlice & SettingsSlice;

export const useStore = create<Store>()((...a) => ({
  ...sessionSlice(...a),
  ...cursorSlice(...a),
  ...selectionSlice(...a),
  ...layoutSlice(...a),
  ...pipelineSlice(...a),
  ...settingsSlice(...a),
}));

/** Non-reactive accessor for command handlers. */
export const store = () => useStore.getState();
