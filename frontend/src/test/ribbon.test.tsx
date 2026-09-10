/**
 * The ribbon is the one place in the app where a user types a parameter and an
 * MNE call happens. Two classes of bug live here and neither shows up as a
 * crash:
 *
 *  1. **the wrong parameter name.** `set_montage` takes `montage_name`, not
 *     `montage`; `set_reference` takes `mode`, not `ref`. Get one wrong and the
 *     server answers 422 with a message nobody reads, or worse, silently
 *     ignores it. These tests pin the exact payload of every ribbon action.
 *  2. **a gate that lies.** Fit ICA needs a montage *and* a 1 Hz high-pass. An
 *     enabled button that cannot succeed is worse than a disabled one, because
 *     the user blames themselves for the error.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { Ribbon } from "../components/shell/Ribbon";
import { installBrowserShims, renderAt, setSituation } from "./harness";

const runOp = vi.fn(async () => {});
vi.mock("../lib/ops", async () => ({
  runOp: (...a: unknown[]) => runOp(...(a as [])),
  applyOp: async () => {},
  pollJob: async () => ({}),
  MONTAGES: ["standard_1020", "biosemi64"],
  parseTime: (s: string) => Number(s),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("../api/client", () => ({
  api: {
    exportRawUrl: () => "/raw.fif",
    exportPipelineUrl: () => "/pipeline.py",
    exportSummaryUrl: () => "/summary.csv",
  },
}));

beforeAll(installBrowserShims);
beforeEach(() => {
  cleanup();
  runOp.mockClear();
  localStorage.clear();
});

/** Open a ribbon tab by name, at desktop width. Clicking the *open* tab
 *  collapses the ribbon, so only click when it is not already selected. */
function openTab(name: string) {
  renderAt(1400, <Ribbon onNewSession={() => {}} />);
  const tab = screen.getByRole("tab", { name });
  if (tab.getAttribute("aria-selected") !== "true") fireEvent.click(tab);
}

const isDisabled = (label: string | RegExp) =>
  (screen.getByText(label).closest("button") as HTMLButtonElement).disabled;

const lastCall = () => runOp.mock.calls.at(-1) as unknown as [string, Record<string, unknown>, string];

describe("Clean: band-pass", () => {
  it("sends l_freq and h_freq, the names the operation actually declares", () => {
    setSituation("fresh");
    openTab("Clean");
    fireEvent.change(screen.getByLabelText(/high-pass/i), { target: { value: "0.5" } });
    fireEvent.change(screen.getByLabelText(/low-pass/i), { target: { value: "45" } });
    fireEvent.click(screen.getAllByText("Apply")[0]);

    const [op, params] = lastCall();
    expect(op).toBe("filter");
    expect(params).toEqual({ l_freq: 0.5, h_freq: 45 });
  });

  it("treats a blank cut-off as 'no bound', not as zero", () => {
    setSituation("fresh");
    openTab("Clean");
    fireEvent.change(screen.getByLabelText(/high-pass/i), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText(/low-pass/i), { target: { value: "40" } });
    fireEvent.click(screen.getAllByText("Apply")[0]);
    expect(lastCall()[1]).toEqual({ l_freq: null, h_freq: 40 });
  });

  it("refuses an inverted band instead of sending it to the server", () => {
    setSituation("fresh");
    openTab("Clean");
    fireEvent.change(screen.getByLabelText(/high-pass/i), { target: { value: "40" } });
    fireEvent.change(screen.getByLabelText(/low-pass/i), { target: { value: "1" } });
    fireEvent.click(screen.getAllByText("Apply")[0]);
    expect(runOp).not.toHaveBeenCalled();
  });

  it("submits on Enter, so the hot operation needs no mouse", () => {
    setSituation("fresh");
    openTab("Clean");
    fireEvent.keyDown(screen.getByLabelText(/low-pass/i), { key: "Enter" });
    expect(lastCall()[0]).toBe("filter");
  });
});

describe("Clean: notch and reference", () => {
  it("sends the notch frequency as a list", () => {
    setSituation("fresh");
    openTab("Clean");
    fireEvent.change(screen.getByLabelText(/line/i), { target: { value: "50" } });
    fireEvent.click(screen.getAllByText("Apply")[1]);
    const [op, params] = lastCall();
    expect(op).toBe("notch");
    expect(params).toEqual({ freqs: [50] });
  });

  it("re-references with `mode`, the parameter the operation declares", () => {
    setSituation("fresh");
    openTab("Clean");
    fireEvent.click(screen.getAllByText("Apply")[2]);
    expect(lastCall()).toEqual(expect.arrayContaining(["set_reference", { mode: "average" }]));
  });
});

describe("Home: montage and resample", () => {
  it("sends montage_name, not montage", () => {
    setSituation("fresh");
    openTab("Home");
    fireEvent.click(screen.getByText("Set"));
    expect(lastCall()[1]).toEqual({ montage_name: "standard_1020" });
  });

  it("resamples with a numeric sfreq seeded from the recording", () => {
    setSituation("fresh");
    openTab("Home");
    fireEvent.click(screen.getByText("Resample"));
    expect(lastCall()).toEqual(expect.arrayContaining(["resample", { sfreq: 256 }]));
  });

  it("rejects a non-numeric sample rate", () => {
    setSituation("fresh");
    openTab("Home");
    fireEvent.change(screen.getByLabelText(/rate/i), { target: { value: "fast" } });
    fireEvent.click(screen.getByText("Resample"));
    expect(runOp).not.toHaveBeenCalled();
  });
});

describe("gates tell the truth about what can run", () => {
  it("blocks Fit ICA until there is a montage and a 1 Hz high-pass", () => {
    setSituation("fresh"); // montage, but no filter
    openTab("Decompose");
    expect(isDisabled("Fit")).toBe(true);
  });

  it("opens Fit ICA once both prerequisites hold", () => {
    setSituation("filtered");
    openTab("Decompose");
    expect(isDisabled("Fit")).toBe(false);
    fireEvent.click(screen.getByText("Fit"));
    expect(lastCall()).toEqual(expect.arrayContaining(["fit_ica", { n_components: 20 }]));
  });

  it("blocks Interpolate until a channel is actually marked bad", () => {
    setSituation("fresh");
    openTab("Home");
    expect(isDisabled("Interpolate")).toBe(true);
    cleanup();
    setSituation("with-bads");
    openTab("Home");
    expect(isDisabled("Interpolate")).toBe(false);
  });

  it("blocks source localisation without electrode positions", () => {
    setSituation("no-montage");
    openTab("Source");
    expect(isDisabled(/Compute at cursor/)).toBe(true);
  });
});

describe("Export offers every artefact the backend can produce", () => {
  it("links the script, the data and the summary", () => {
    setSituation("fresh");
    openTab("Export");
    for (const name of ["pipeline.py", "raw.fif", "summary.csv"]) {
      expect(screen.getByText(name).closest("a")).toHaveProperty("download");
    }
  });
});
