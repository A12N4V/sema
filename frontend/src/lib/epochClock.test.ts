import { describe, expect, it } from "vitest";
import { epochAt, recordingTimeOf, type EpochsClock } from "./epochClock";

// tmin = -0.2, so a trial whose event is at 10 s starts at 9.8 s and the
// `onsets` entry is that start, not the event.
const clock: EpochsClock = { onsets: [9.8, 19.8, 29.8], tmin: -0.2, tmax: 0.8 };

describe("mapping the transport cursor onto the epoch clock", () => {
  it("finds the trial the cursor is inside, and where in it", () => {
    const hit = epochAt(clock, 10.15);
    expect(hit?.index).toBe(0);
    expect(hit?.latency).toBeCloseTo(0.15, 6);
  });

  it("reports the event itself as latency zero", () => {
    expect(epochAt(clock, 20)?.latency).toBeCloseTo(0, 6);
    expect(epochAt(clock, 20)?.index).toBe(1);
  });

  it("says nothing rather than guessing when the cursor is between trials", () => {
    // The gap matters: an epoched pane that snapped to the nearest trial here
    // would show a latency the cursor is not actually at.
    expect(epochAt(clock, 15)).toBeNull();
    expect(epochAt(clock, 0)).toBeNull();
  });

  it("has no opinion without epochs", () => {
    expect(epochAt(null, 5)).toBeNull();
    expect(epochAt({ onsets: [], tmin: -0.2, tmax: 0.8 }, 5)).toBeNull();
  });

  it("round-trips back to recording time", () => {
    const hit = epochAt(clock, 30.4)!;
    expect(recordingTimeOf(clock, hit.index, hit.latency)).toBeCloseTo(30.4, 6);
  });

  it("refuses a trial index it does not have", () => {
    expect(recordingTimeOf(clock, 9, 0)).toBeNull();
  });
});
