/**
 * The features built to close the gap against EEGLAB, tested at the level a
 * user meets them.
 *
 * The shared theme: each of these replaces "type the answer into a box" with
 * "see the evidence and act on it", and each writes through the operation
 * registry so it lands in the ledger. The tests pin the payloads, because a
 * wrong parameter name here fails silently as a 422 in a toast.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { ChannelsTable } from "../components/panels/ChannelsTable";
import { Annotations } from "../components/panels/Annotations";
import { installBrowserShims, renderAt, setSituation } from "./harness";
import { useStore } from "../store/store";

const runOp = vi.fn(async () => {});
vi.mock("../lib/ops", () => ({
  runOp: (...a: unknown[]) => runOp(...(a as [])),
  applyOp: async () => {},
  pollJob: async () => ({}),
  MONTAGES: ["standard_1020"],
  parseTime: (s: string) => Number(s),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const CHANNELS = [
  { index: 0, name: "Fp1", type: "eeg", bad: false, has_position: true, unit: "µV",
    mean: 0.1, std: 12.4, peak_to_peak: 88.2, flat: false },
  { index: 1, name: "Cz", type: "eeg", bad: true, has_position: true, unit: "µV",
    mean: 0.0, std: 190.0, peak_to_peak: 900.5, flat: false },
  { index: 2, name: "Oz", type: "eeg", bad: false, has_position: false, unit: "µV",
    mean: 0.0, std: 0.0, peak_to_peak: 0.0, flat: true },
];
const ANNOTATIONS = [
  { index: 0, onset: 2.5, duration: 0, description: "stim", bad: false },
  { index: 1, onset: 9.0, duration: 1.5, description: "BAD_muscle", bad: true },
];

vi.mock("../api/client", () => ({
  api: {
    channels: async () => ({ channels: CHANNELS, sampled_every: 1 }),
    annotations: async () => ({ annotations: ANNOTATIONS, labels: ["BAD_muscle", "stim"], duration: 180 }),
  },
  ApiError: class extends Error {},
}));

beforeAll(installBrowserShims);
beforeEach(() => {
  cleanup();
  runOp.mockClear();
});

const lastCall = () => runOp.mock.calls.at(-1) as unknown as [string, Record<string, unknown>, string];

/**
 * Wait for the panel's fetch to land. `waitFor` wraps the retry in `act`, which
 * a bare timeout does not: without it React never flushes the state update and
 * every one of these tests sees an empty table.
 */
const settle = () => waitFor(() => expect(document.body.textContent).toContain("Fp1"));
/**
 * The annotations pane shows its empty state first, so wait for a real row.
 * Matched on the label rather than the onset: the "add at 42.50s" button also
 * contains "2.50s", and waiting on that let every test click before the fetch
 * landed while still looking green.
 */
const settleAnnotations = () =>
  waitFor(() => expect(document.body.textContent).toContain("BAD_muscle"));

describe("the channel table", () => {
  it("shows a row per channel with the numbers you sort a decision out of", async () => {
    setSituation("with-bads");
    renderAt(1400, <ChannelsTable />);
    await settle();

    for (const name of ["Fp1", "Cz", "Oz"]) expect(screen.getByText(name)).toBeDefined();
    expect(screen.getByText("900.5")).toBeDefined();   // peak to peak, in µV
    expect(screen.getByText("12.4")).toBeDefined();    // standard deviation
  });

  it("renames through the operation registry, not through a bespoke route", async () => {
    setSituation("fresh");
    renderAt(1400, <ChannelsTable />);
    await settle();

    fireEvent.click(screen.getByText("Fp1"));
    const input = screen.getByLabelText("Rename Fp1");
    fireEvent.change(input, { target: { value: "LEFT_FRONTAL" } });
    fireEvent.keyDown(input, { key: "Enter" });

    const [op, params] = lastCall();
    expect(op).toBe("rename_channels");
    expect(params).toEqual({ mapping: { Fp1: "LEFT_FRONTAL" } });
  });

  it("refuses a rename that would collide with an existing channel", async () => {
    setSituation("fresh");
    renderAt(1400, <ChannelsTable />);
    await settle();

    fireEvent.click(screen.getByText("Fp1"));
    const input = screen.getByLabelText("Rename Fp1");
    fireEvent.change(input, { target: { value: "Cz" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(runOp).not.toHaveBeenCalled();
  });

  it("retypes a channel with the parameter the operation declares", async () => {
    setSituation("fresh");
    renderAt(1400, <ChannelsTable />);
    await settle();

    fireEvent.change(screen.getByLabelText("Type of Fp1"), { target: { value: "eog" } });
    expect(lastCall()).toEqual(expect.arrayContaining([
      "set_channel_types", { mapping: { Fp1: "eog" } },
    ]));
  });

  it("toggles bad by sending the whole new list, which is what set_bads takes", async () => {
    setSituation("fresh");
    useStore.setState({ session: { ...useStore.getState().session!, bads: ["Cz"] } });
    renderAt(1400, <ChannelsTable />);
    await settle();

    fireEvent.click(screen.getByLabelText("Mark Fp1 bad"));
    expect(lastCall()).toEqual(expect.arrayContaining([
      "set_bads", { bads: ["Cz", "Fp1"] },
    ]));

    fireEvent.click(screen.getByLabelText("Unmark Cz"));
    expect(lastCall()).toEqual(expect.arrayContaining(["set_bads", { bads: [] }]));
  });

  it("drops a channel", async () => {
    setSituation("fresh");
    renderAt(1400, <ChannelsTable />);
    await settle();
    fireEvent.click(screen.getByLabelText("Drop Oz"));
    expect(lastCall()).toEqual(expect.arrayContaining(["drop_channels", { channels: ["Oz"] }]));
  });

  it("offers automatic detection, the channel half of clean_rawdata", async () => {
    setSituation("fresh");
    renderAt(1400, <ChannelsTable />);
    await settle();
    fireEvent.click(screen.getByText("Detect bad"));
    expect(lastCall()[0]).toBe("detect_bad_channels");
  });

  it("filters the table without touching the recording", async () => {
    setSituation("fresh");
    renderAt(1400, <ChannelsTable />);
    await settle();

    fireEvent.change(screen.getByLabelText("Filter channels"), { target: { value: "cz" } });
    expect(screen.queryByText("Fp1")).toBeNull();
    expect(screen.getByText("Cz")).toBeDefined();
    expect(runOp).not.toHaveBeenCalled();
  });

  it("drives which channels the waveform draws", async () => {
    setSituation("fresh");
    useStore.setState({ selectedChannels: ["Fp1", "Cz", "Oz"] });
    renderAt(1400, <ChannelsTable />);
    await settle();

    fireEvent.click(screen.getByLabelText("Show Cz in the waveform"));
    expect(useStore.getState().selectedChannels).toEqual(["Fp1", "Oz"]);
  });
});

describe("annotations", () => {
  it("lists events and bad spans, and tells them apart", async () => {
    setSituation("with-annotations");
    renderAt(1400, <Annotations />);
    await settleAnnotations();

    expect(screen.getByText("2.50s")).toBeDefined();
    expect(screen.getByText("point")).toBeDefined();     // zero duration
    expect(screen.getByText("1.50s")).toBeDefined();     // a span
    const bad = screen.getByText("BAD_muscle");
    expect(bad.className).toContain("alert");
  });

  it("adds one at the cursor, which is the whole point of the control", async () => {
    setSituation("with-annotations");
    useStore.setState({ t: 42.5 });
    renderAt(1400, <Annotations />);
    await settleAnnotations();

    fireEvent.change(screen.getByLabelText("Annotation label"), { target: { value: "blink" } });
    fireEvent.change(screen.getByLabelText("Annotation duration"), { target: { value: "0.4" } });
    fireEvent.click(screen.getByText(/at 42.50s/));

    const [op, params] = lastCall();
    expect(op).toBe("set_annotations");
    // the whole set is sent, so the ledger entry replays as a value
    expect((params.annotations as unknown[]).length).toBe(3);
    expect((params.annotations as { description: string }[]).at(-1)).toEqual({
      onset: 42.5, duration: 0.4, description: "blink",
    });
  });

  it("refuses an unlabelled annotation", async () => {
    setSituation("with-annotations");
    renderAt(1400, <Annotations />);
    await settleAnnotations();
    fireEvent.change(screen.getByLabelText("Annotation label"), { target: { value: "  " } });
    fireEvent.click(screen.getByText(/^at /));
    expect(runOp).not.toHaveBeenCalled();
  });

  it("deletes by sending the set without that entry", async () => {
    setSituation("with-annotations");
    renderAt(1400, <Annotations />);
    await settleAnnotations();

    fireEvent.click(screen.getByLabelText("Delete annotation at 2.50 seconds"));
    const [, params] = lastCall();
    expect((params.annotations as { description: string }[]).map((a) => a.description))
      .toEqual(["BAD_muscle"]);
  });

  it("seeks the shared cursor, so the table and the trace are one clock", async () => {
    setSituation("with-annotations");
    renderAt(1400, <Annotations />);
    await settleAnnotations();

    fireEvent.click(screen.getByText("9.00s"));
    expect(useStore.getState().t).toBe(9);
  });

  it("counts each label so a detection pass is legible at a glance", async () => {
    setSituation("with-annotations");
    const { container } = renderAt(1400, <Annotations />);
    await settleAnnotations();
    const chips = within(container).getAllByText(/stim 1|BAD_muscle 1/);
    expect(chips.length).toBe(2);
  });
});
