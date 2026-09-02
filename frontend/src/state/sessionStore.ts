import { create } from "zustand";
import type { SessionInfo, ICAComponent } from "../api/client";

export type Step = "upload" | "viewer" | "preprocess" | "ica" | "spectral" | "export";

interface SessionState {
  session: SessionInfo | null;
  step: Step;
  selectedChannels: string[];
  windowStart: number;
  windowDuration: number;
  icaComponents: ICAComponent[];
  loading: boolean;
  error: string | null;

  setSession: (s: SessionInfo | null) => void;
  updateSession: (s: SessionInfo) => void;
  setStep: (s: Step) => void;
  setSelectedChannels: (c: string[]) => void;
  setWindow: (start: number, duration: number) => void;
  setIcaComponents: (c: ICAComponent[]) => void;
  setLoading: (b: boolean) => void;
  setError: (e: string | null) => void;
  reset: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  session: null,
  step: "upload",
  selectedChannels: [],
  windowStart: 0,
  windowDuration: 10,
  icaComponents: [],
  loading: false,
  error: null,

  setSession: (s) =>
    // Used for the initial upload (or clearing the session) — jumps to the
    // viewer since that's the natural first step for a freshly loaded file.
    set({
      session: s,
      selectedChannels: s ? s.channel_names : [],
      step: s ? "viewer" : "upload",
    }),
  updateSession: (s) =>
    // Used after a preprocessing/ICA/etc. mutation on an existing session —
    // refreshes the info panel in place without yanking the user back to
    // the Viewer tab mid-workflow.
    set({ session: s }),
  setStep: (step) => set({ step }),
  setSelectedChannels: (c) => set({ selectedChannels: c }),
  setWindow: (windowStart, windowDuration) => set({ windowStart, windowDuration }),
  setIcaComponents: (icaComponents) => set({ icaComponents }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  reset: () =>
    set({
      session: null,
      step: "upload",
      selectedChannels: [],
      windowStart: 0,
      windowDuration: 10,
      icaComponents: [],
      loading: false,
      error: null,
    }),
}));
