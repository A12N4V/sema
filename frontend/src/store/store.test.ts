/**
 * Scaffolding regression net for the store: the shared state every pane
 * reads. These guard invariants that are easy to break silently in a refactor
 * and that no type check can catch.
 *
 * The cursor slice is marked a FROZEN CONTRACT in store.ts (`t` is absolute
 * seconds; the window is where the waveform is looking). Most of what follows
 * pins that contract down.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useStore } from "./store";
import type { SessionInfo } from "../api/client";

const session = {
  session_id: "test",
  filename: "test.edf",
  n_channels: 4,
  channel_names: ["Fp1", "Fp2", "Cz", "Oz"],
  channel_types: { Fp1: "eeg", Fp2: "eeg", Cz: "eeg", Oz: "eeg" },
  channel_type_counts: { eeg: 4 },
  sfreq: 256,
  n_times: 15360,
  duration_seconds: 60,
  highpass: 0,
  lowpass: 128,
  bads: [],
  has_montage: false,
  annotations: [],
  modalities: ["eeg"],
  meas_date: null,
} as unknown as SessionInfo;

/** Reset to a known state without a session; individual tests opt in. */
beforeEach(() => {
  useStore.setState({
    session: null,
    t: 0,
    windowStart: 0,
    windowDuration: 10,
    playing: false,
    speed: 1,
    selectedChannels: [],
    focusChannel: null,
    selectedStep: null,
    component: null,
    band: "alpha",
    maximized: null,
  });
});

const s = () => useStore.getState();

describe("cursor: t is absolute seconds, clamped to the recording", () => {
  beforeEach(() => useStore.setState({ session }));

  it("clamps below zero", () => {
    s().setCursor(-5);
    expect(s().t).toBe(0);
  });

  it("clamps past the end of the recording", () => {
    s().setCursor(999);
    expect(s().t).toBe(60);
  });

  it("nudge accumulates and stays clamped", () => {
    s().setCursor(59);
    s().nudgeCursor(5);
    expect(s().t).toBe(60);
    s().nudgeCursor(-100);
    expect(s().t).toBe(0);
  });

  it("does not clamp when no session is loaded", () => {
    useStore.setState({ session: null });
    s().setCursor(1e6);
    expect(s().t).toBe(1e6);
  });
});

describe("cursor: seekTo recentres the window only when it has to", () => {
  beforeEach(() => useStore.setState({ session }));

  it("leaves the window alone when the cursor lands inside it", () => {
    s().setWindow(10, 10);
    s().seekTo(15);
    expect(s().windowStart).toBe(10);
    expect(s().t).toBe(15);
  });

  it("recentres when the cursor lands outside", () => {
    s().setWindow(0, 10);
    s().seekTo(40);
    // centred: 40 - 10/2
    expect(s().windowStart).toBe(35);
    expect(s().t).toBe(40);
  });
});

describe("cursor: the window never leaves the recording", () => {
  beforeEach(() => useStore.setState({ session }));

  it("clamps a negative start to zero", () => {
    s().setWindow(-20);
    expect(s().windowStart).toBe(0);
  });

  it("stops so the window's right edge sits at the end", () => {
    s().setWindow(1000, 10);
    expect(s().windowStart).toBe(50); // 60 - 10
  });

  it("pages by 90% so a sliver of context is retained", () => {
    s().setWindow(0, 10);
    s().pageWindow(1);
    expect(s().windowStart).toBeCloseTo(9);
    s().pageWindow(-1);
    expect(s().windowStart).toBeCloseTo(0);
  });

  it("never scrolls past the start when paging back", () => {
    s().setWindow(0, 10);
    s().pageWindow(-1);
    expect(s().windowStart).toBe(0);
  });
});

describe("selection: focus and step are mutually exclusive", () => {
  // Both drive the inspector-ish surfaces; having both set at once would make
  // the UI show two different "current things".
  it("picking a channel clears the selected step", () => {
    useStore.setState({ selectedStep: 3 });
    s().setFocusChannel("Cz");
    expect(s().focusChannel).toBe("Cz");
    expect(s().selectedStep).toBeNull();
  });

  it("picking a step clears the focused channel", () => {
    useStore.setState({ focusChannel: "Cz" });
    s().setSelectedStep(2);
    expect(s().selectedStep).toBe(2);
    expect(s().focusChannel).toBeNull();
  });
});

describe("selection: channel toggling", () => {
  it("adds then removes", () => {
    s().toggleChannel("Cz");
    expect(s().selectedChannels).toEqual(["Cz"]);
    s().toggleChannel("Cz");
    expect(s().selectedChannels).toEqual([]);
  });

  it("preserves order of other selections", () => {
    s().toggleChannel("Fp1");
    s().toggleChannel("Cz");
    s().toggleChannel("Oz");
    s().toggleChannel("Cz");
    expect(s().selectedChannels).toEqual(["Fp1", "Oz"]);
  });
});

describe("layout: one pane maximized at a time", () => {
  it("toggles the same pane off", () => {
    s().toggleMaximized("waveform");
    expect(s().maximized).toBe("waveform");
    s().toggleMaximized("waveform");
    expect(s().maximized).toBeNull();
  });

  it("switches directly between panes without passing through null", () => {
    s().toggleMaximized("waveform");
    s().toggleMaximized("visuals");
    expect(s().maximized).toBe("visuals");
  });
});

describe("session: loading one resets view state", () => {
  it("clears a stale maximized pane and cursor from a previous session", () => {
    useStore.setState({ maximized: "ica", t: 42, windowStart: 30 });
    s().setSession(session);
    expect(s().maximized).toBeNull();
    expect(s().windowStart).toBe(0);
    expect(s().selectedChannels.length).toBeGreaterThan(0);
  });

  it("seeds the channel selection with every channel, not a prefix", () => {
    s().setSession(session);
    expect(s().selectedChannels).toEqual(session.channel_names);
    // The waveform pages through them and states its range. Seeding with a
    // slice made a 64-channel recording report "1-16 of 16", which claims to
    // be the whole montage while hiding three quarters of it.
    expect(s().selectedChannels).toHaveLength(session.channel_names.length);
  });
});
