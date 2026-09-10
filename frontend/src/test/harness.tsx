/**
 * Shared rig for the UI tests.
 *
 * Two things every UI test here needs and jsdom does not provide:
 *
 *  - **matchMedia**, because the layout genuinely branches on it (a draggable
 *    two-column split above 900px, a stacked scroll below). Without a viewport
 *    the responsive code path is simply never exercised, which is exactly where
 *    the last two layout bugs were.
 *  - **a canvas context**, because every plot paints to one and jsdom's canvas
 *    is a stub that throws. The tests below care whether a pane *mounts and
 *    survives its state*, not what pixels it drew, so a no-op 2D context is the
 *    right level of fidelity.
 *
 * `renderAt` sets a viewport width, so a test can say "at 375px" out loud.
 */
import { render, type RenderResult } from "@testing-library/react";
import { vi } from "vitest";
import type { ReactElement } from "react";
import { useStore } from "../store/store";
import type { ContainerRef, SessionInfo } from "../api/client";

/* ------------------------------------------------------------- environment */

let viewportWidth = 1400;

/** Install the jsdom shims. Call once per test file, in `beforeAll`. */
export function installBrowserShims(): void {
  window.matchMedia = ((query: string) => {
    // only the two forms the app actually uses
    const min = /min-width:\s*(\d+)px/.exec(query);
    const max = /max-width:\s*(\d+)px/.exec(query);
    const matches = min
      ? viewportWidth >= Number(min[1])
      : max
        ? viewportWidth <= Number(max[1])
        : false;
    return {
      matches,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;

  const ctx = new Proxy({}, {
    get: (_t, prop) =>
      prop === "canvas" ? undefined
        : prop === "measureText" ? () => ({ width: 10 })
          : prop === "getImageData" ? () => ({ data: new Uint8ClampedArray(4) })
            : () => undefined,
  });
  HTMLCanvasElement.prototype.getContext = (() => ctx) as unknown as HTMLCanvasElement["getContext"];

  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
  if (!URL.createObjectURL) {
    URL.createObjectURL = () => "blob:test";
    URL.revokeObjectURL = () => {};
  }
}

/** Render at a stated viewport width, so responsive branches are explicit. */
export function renderAt(width: number, ui: ReactElement): RenderResult {
  viewportWidth = width;
  return render(ui);
}

/* ------------------------------------------------------------------ session */

export const DEMO: SessionInfo = {
  session_id: "s1",
  filename: "demo.edf",
  channel_names: ["Fp1", "Fp2", "Cz", "Oz"],
  channel_types: ["eeg", "eeg", "eeg", "eeg"],
  channel_type_counts: { eeg: 4 },
  n_channels: 4,
  sfreq: 256,
  n_times: 46080,
  duration_seconds: 180,
  bads: [],
  highpass: 0,
  lowpass: 128,
  has_montage: true,
  annotations: [],
  meas_date: null,
  modalities: { primary: ["eeg"], aux: [], channel_types: ["eeg"], type_counts: { eeg: 4 } },
} as unknown as SessionInfo;

/**
 * Put the store into one named situation. The point of the matrix is that a
 * pane must survive *every* one of these, not just the happy one.
 */
export type Situation =
  | "fresh"          // just loaded, nothing done
  | "no-montage"     // the gate most panes hang off
  | "filtered"       // 1 Hz high-pass, so ICA is unlocked
  | "with-ica"
  | "with-labels"    // ICA classified by ICLabel
  | "with-source"
  | "with-bads"
  | "with-annotations"
  | "with-epochs"
  | "with-evoked"
  | "with-tfr";

export function setSituation(s: Situation): void {
  const session: SessionInfo = { ...DEMO };
  const caps: string[] = ["montage"];
  const graph: ContainerRef[] = [
    { id: "raw", kind: "raw", label: "Raw · 4 ch", parent_id: null, op_id: null, created_at: 0 },
  ];
  let hasIca = false;

  if (s === "no-montage") {
    session.has_montage = false;
    caps.length = 0;
  }
  if (s === "filtered" || s === "with-ica" || s === "with-source") {
    session.highpass = 1;
    session.lowpass = 40;
    caps.push("filtered_1hz");
  }
  if (s === "with-bads") {
    session.bads = ["Fp1"];
    caps.push("has_bads");
  }
  if (s === "with-ica" || s === "with-labels") {
    hasIca = true;
    caps.push("ica");
    graph.push({ id: "ica", kind: "ica", label: "ICA · 12 comp", parent_id: "raw", op_id: "fit_ica", created_at: 1 });
  }
  if (s === "with-labels") caps.push("ica_labels");
  if (s === "with-annotations") caps.push("annotations");
  if (s === "with-epochs" || s === "with-evoked" || s === "with-tfr") {
    caps.push("epochs");
    graph.push({ id: "epochs", kind: "epochs", label: "Epochs · 42 trials",
                 parent_id: "raw", op_id: "make_epochs", created_at: 3 });
  }
  if (s === "with-evoked") {
    caps.push("evoked");
    graph.push({ id: "evoked", kind: "evoked", label: "Evoked · 42 averaged",
                 parent_id: "epochs", op_id: "average_epochs", created_at: 4 });
  }
  if (s === "with-tfr") {
    caps.push("tfr");
    graph.push({ id: "tfr", kind: "tfr", label: "TFR · 24 freqs",
                 parent_id: "epochs", op_id: "compute_tfr", created_at: 5 });
  }
  if (s === "with-source") {
    caps.push("source");
    graph.push({ id: "source", kind: "stc", label: "Source · dSPM", parent_id: "raw", op_id: "compute_source", created_at: 2 });
  }

  useStore.setState({
    session,
    capabilities: caps,
    containerGraph: graph,
    hasIca,
    history: [],
    leaves: [],
    ledgerHead: 0,
    t: 12,
    windowStart: 10,
    windowDuration: 10,
    playing: false,
    speed: 1,
    selectedChannels: session.channel_names,
    focusChannel: null,
    selectedStep: null,
    maximized: null,
    filmstrip: null,
    prepState: "idle",
    prepProgress: 0,
    prepDetail: "",
  });
}

export const SITUATIONS: Situation[] = [
  "fresh", "no-montage", "filtered", "with-ica", "with-labels", "with-source",
  "with-bads", "with-annotations", "with-epochs", "with-evoked", "with-tfr",
];

/* ---------------------------------------------------------------- console */

/**
 * Fail a test on any React error/warning. A pane that renders "successfully"
 * while logging "Cannot read properties of undefined" is broken; jsdom just
 * doesn't throw for it.
 */
export function failOnConsoleError(): () => void {
  const seen: string[] = [];
  const spyError = vi.spyOn(console, "error").mockImplementation((...a) => seen.push(String(a[0])));
  const spyWarn = vi.spyOn(console, "warn").mockImplementation((...a) => seen.push(String(a[0])));
  return () => {
    spyError.mockRestore();
    spyWarn.mockRestore();
    if (seen.length) throw new Error(`console output during render:\n${seen.join("\n")}`);
  };
}
