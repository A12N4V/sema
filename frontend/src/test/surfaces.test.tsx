/**
 * "Does the UI break anywhere?"
 *
 * The failure this suite exists for is the one that actually happens: a pane
 * that is fine in the state you developed it in and throws in one of the five
 * other states the app can be in. No montage. No ICA. No source. Bad channels
 * marked. A phone-width viewport. Nobody clicks through all thirty of those
 * combinations by hand after every change, so nobody finds the broken one until
 * a user does.
 *
 * So: mount every surface in every situation, at both a desktop and a phone
 * width, and fail on a thrown error *or* a React console error. It runs in
 * about a second and needs no browser.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { Workspace } from "../components/shell/Workspace";
import { Ribbon } from "../components/shell/Ribbon";
import { ContainerStrip } from "../components/shell/ContainerStrip";
import { TimeBar } from "../components/shell/TimeBar";
import { PAGES, type Page } from "../lib/router";
import {
  SITUATIONS, failOnConsoleError, installBrowserShims, renderAt, setSituation,
} from "./harness";

// Every network call is stubbed: this suite is about whether the UI can render
// what the store holds, not about the server.
vi.mock("../api/client", () => {
  const empty = async () => ({});
  return {
    api: {
      getSession: empty,
      listOps: async () => ({ operations: [] }),
      runOp: async () => ({ session: {}, graph: [], capabilities: [], history: [], op_id: "x" }),
      revert: empty,
      fitIca: async () => ({ n_components: 0, components: [] }),
      icaExclude: async () => ({ components: [] }),
      applyIca: async () => ({ applied: true, excluded: [] }),
      pipelineText: async () => "",
      sessionJobs: async () => ({ jobs: [] }),
      montageLayout: async () => ({ channels: [], pos2d: [], pos3d: [], has_montage: true }),
      history: async () => ({ entries: [], head: 0, leaves: [], montage_name: null, has_ica: false }),
      graph: async () => ({ graph: [], capabilities: [] }),
      window: async () => ({ channels: [], sfreq: 256, t0: 0, dt: 1, time: [], data: {} }),
      overview: async () => ({ t: [], rms: [], duration: 180 }),
      psd: async () => ({ freqs: [], channels: [], psd_db: [] }),
      bandPower: async () => ({ channels: [], bands: {} }),
      icaComponents: async () => ({ components: [] }),
      channels: async () => ({ channels: [], sampled_every: 1 }),
      annotations: async () => ({ annotations: [], labels: [], duration: 180 }),
      epochsSummary: async () => ({
        n_epochs: 42, n_dropped: 3, drop_percent: 6.7, tmin: -0.2, tmax: 0.8, sfreq: 256,
        conditions: { stim: 42 }, channels: ["Fp1", "Cz"], dropped: [] }),
      epochsImage: async () => ({ times: [0, 0.1], matrix: [[1, 2], [3, 4]],
                                  channel: "Fp1", vlim: 10, n_epochs: 2 }),
      evoked: async () => ({ times: [0, 0.1], channels: ["Fp1"], data: { Fp1: [1, 2] },
                             gfp: [1, 2], nave: 42, peak_channel: "Fp1", peak_time: 0.1,
                             comment: "" }),
      tfr: async () => ({ times: [0, 0.1], freqs: [4, 8], matrix: [[1, 2], [3, 4]],
                          channels: ["Fp1"], channel: null, unit: "dB", vlim: 3 }),
      icaTopomap: async () => ({ index: 0, png_base64: "" }),
      icaSources: async () => null,
      icaComponentPsd: async () => null,
      sourceStatus: async () => ({ has_stc: false, fsaverage_ready: false, meta: {} }),
      sourceTimecourse: async () => ({ t: [], y: [], vertex: 0, label: "", method: "dSPM" }),
      filmstrip: async () => ({ times: [], bands: [], ready: true, blocked: null,
                                state_hash: "x", theme: "dark", width: 280, height: 280, frames_ready: 0 }),
      precompute: async () => ({ job_id: "j", state: "queued" }),
      getJob: async () => ({ state: "done", progress: 1, detail: "" }),
      render: async () => "blob:test",
      exportRawUrl: () => "/raw.fif",
      exportPipelineUrl: () => "/pipeline.py",
      exportSummaryUrl: () => "/summary.csv",
    },
    ApiError: class extends Error {},
  };
});

beforeAll(installBrowserShims);
beforeEach(() => cleanup());
afterEach(() => cleanup());

const WIDTHS: [string, number][] = [["desktop", 1400], ["phone", 375]];

describe("every container renders in every situation", () => {
  for (const page of PAGES) {
    for (const situation of SITUATIONS) {
      for (const [name, width] of WIDTHS) {
        it(`${page} · ${situation} · ${name}`, () => {
          setSituation(situation);
          const done = failOnConsoleError();
          try {
            renderAt(width, <Workspace page={page as Page} onNewSession={() => {}} />);
          } finally {
            done();
          }
          // something was actually drawn, not an empty shell
          expect(document.body.textContent?.length ?? 0).toBeGreaterThan(20);
        });
      }
    }
  }
});

describe("the shell keeps its bearings", () => {
  beforeEach(() => setSituation("with-ica"));

  it("keeps the transport on every cursor-linked container and off Pipeline", () => {
    for (const page of ["signal", "ica", "source"] as const) {
      cleanup();
      renderAt(1400, <Workspace page={page} onNewSession={() => {}} />);
      expect(screen.queryByLabelText("Play"), `${page} lost the transport`).not.toBeNull();
    }
    cleanup();
    renderAt(1400, <Workspace page="pipeline" onNewSession={() => {}} />);
    expect(screen.queryByLabelText("Play"),
      "Pipeline has no time axis, so a transport there is a lie").toBeNull();
  });

  it("marks the open container, and only that one", () => {
    renderAt(1400, <ContainerStrip page="ica" />);
    const current = screen.getAllByRole("button").filter((b) => b.getAttribute("aria-current") === "page");
    expect(current).toHaveLength(1);
    expect(current[0].textContent).toContain("ICA");
  });

  it("shows a container that does not exist yet as unreachable, not as missing", () => {
    setSituation("fresh"); // no ICA, no source
    renderAt(1400, <ContainerStrip page="signal" />);
    const ica = screen.getByTitle(/^ICA:/);
    expect(ica.textContent).toContain("ICA");
  });
});

describe("responsive branches", () => {
  it("collapses the six ribbon tabs to one menu on a phone", () => {
    setSituation("fresh");
    renderAt(375, <Ribbon onNewSession={() => {}} />);
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.getByRole("button", { expanded: false })).toBeDefined();
  });

  it("keeps the tabs, and the session controls, on a desktop", () => {
    setSituation("fresh");
    renderAt(1400, <Ribbon onNewSession={() => {}} />);
    // Home, Clean, Decompose, Epochs, Source, View, Export
    expect(screen.getAllByRole("tab")).toHaveLength(7);
    expect(screen.getByLabelText("Settings")).toBeDefined();
    expect(screen.getByLabelText("New session")).toBeDefined();
  });

  it("puts the visualization above the waveform on a phone", () => {
    setSituation("fresh");
    const { container } = renderAt(375, <Workspace page="signal" onNewSession={() => {}} />);
    const text = container.textContent ?? "";
    expect(text.indexOf("Visualization")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("Visualization")).toBeLessThan(text.indexOf("Waveform"));
  });

  it("shows two independent visualization panes on a desktop", () => {
    setSituation("fresh");
    renderAt(1400, <Workspace page="signal" onNewSession={() => {}} />);
    expect(screen.getByText("Visualization A")).toBeDefined();
    expect(screen.getByText("Visualization B")).toBeDefined();
  });
});

describe("the time bar reports the container it sits under", () => {
  it("names the derivation so two containers cannot be confused", () => {
    setSituation("with-ica");
    renderAt(1400, <TimeBar page="ica" />);
    expect(screen.getByText(/components of Raw/)).toBeDefined();
  });
});
