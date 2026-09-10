/**
 * The clock belongs to the session, not to one pane.
 *
 * This is a regression test for a real complaint: the transport used to live
 * inside the Raw page, so stepping to ICA or Source made play, the cursor
 * readout and the recording's silhouette all disappear, and with them any sign
 * that those containers describe the same recording. If someone moves the
 * TimeBar back inside a page, these fail.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { TimeBar } from "./TimeBar";
import { useStore } from "../../store/store";
import type { SessionInfo } from "../../api/client";

vi.mock("../panels/OgStrip", () => ({ OgStrip: () => <div data-testid="og-strip" /> }));

const session = {
  session_id: "test",
  filename: "test.edf",
  n_channels: 32,
  channel_names: ["Fp1", "Fp2"],
  duration_seconds: 180,
  sfreq: 256,
  n_times: 46080,
  bads: [],
  highpass: 0,
  lowpass: 128,
  has_montage: true,
  annotations: [],
} as unknown as SessionInfo;

beforeEach(() => {
  cleanup();
  useStore.setState({ session, t: 12, windowStart: 10, windowDuration: 10, playing: false, speed: 1 });
});

describe("TimeBar", () => {
  it("gives every cursor-linked container the same transport", () => {
    for (const page of ["signal", "ica", "source"] as const) {
      cleanup();
      render(<TimeBar page={page} />);
      expect(screen.getByLabelText("Play"), `no play button on ${page}`).toBeDefined();
      expect(screen.getByLabelText("Previous window")).toBeDefined();
      expect(screen.getByLabelText("Next window")).toBeDefined();
      expect(screen.getByTestId("og-strip"), `no recording overview on ${page}`).toBeDefined();
    }
  });

  it("names what the viewport shows and what it derives from", () => {
    render(<TimeBar page="ica" />);
    expect(screen.getByText(/components of Raw/)).toBeDefined();
    cleanup();
    render(<TimeBar page="source" />);
    expect(screen.getByText(/inverse of Raw/)).toBeDefined();
  });

  it("shows the shared cursor, not a per-pane one", () => {
    const { container } = render(<TimeBar page="source" />);
    // 12 s into a 3-minute recording (the readout is several text nodes)
    expect(container.textContent).toContain("12.0s");
    expect(container.textContent).toContain("3:00");
  });

  it("renders nothing without a session", () => {
    useStore.setState({ session: null });
    const { container } = render(<TimeBar page="signal" />);
    expect(container.firstChild).toBeNull();
  });

  it("the play control reflects and drives the shared playing state", () => {
    render(<TimeBar page="ica" />);
    screen.getByLabelText("Play").click();
    expect(useStore.getState().playing).toBe(true);
    cleanup();
    render(<TimeBar page="ica" />);
    expect(screen.getByLabelText("Pause")).toBeDefined();
  });
});
