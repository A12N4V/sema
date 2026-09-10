/**
 * The two clocks, and the one place they are reconciled.
 *
 * The transport cursor runs in recording seconds. Everything downstream of
 * `mne.Epochs` runs in trial-relative seconds, where 0 is the event and the
 * axis spans `tmin..tmax`. Those are genuinely different clocks, and pretending
 * otherwise would be worse than leaving the panes unlinked: a latency of 0.2 s
 * means nothing until you say 0.2 s *after what*.
 *
 * So the mapping is explicit and partial. When the recording cursor happens to
 * fall inside a trial, this says which trial and where in it. When it does not,
 * it says so, and the epoched panes fall back to their own default rather than
 * inventing a link that is not there.
 */

export interface EpochsClock {
  onsets: number[];      // trial start in recording seconds (already includes tmin)
  tmin: number;
  tmax: number;
}

export interface EpochHit {
  /** Index into `onsets`: which trial the cursor is inside. */
  index: number;
  /** Where in that trial, on the epoch clock (`tmin..tmax`). */
  latency: number;
}

/** Which trial the recording cursor is inside, and where, or null. */
export function epochAt(clock: EpochsClock | null | undefined, t: number): EpochHit | null {
  if (!clock || !clock.onsets.length) return null;
  const span = clock.tmax - clock.tmin;
  if (!(span > 0)) return null;

  // Trials can overlap (a short ISI with a long window), so the nearest onset
  // at or before the cursor is not always the right answer. Take the trial whose
  // centre is closest among those actually containing the cursor.
  let best: EpochHit | null = null;
  for (let i = 0; i < clock.onsets.length; i++) {
    const rel = t - clock.onsets[i] + clock.tmin;
    if (rel < clock.tmin || rel > clock.tmax) continue;
    const centre = Math.abs(rel - (clock.tmin + span / 2));
    if (best === null || centre < Math.abs(best.latency - (clock.tmin + span / 2))) {
      best = { index: i, latency: rel };
    }
  }
  return best;
}

/** The inverse: a latency inside trial `index`, back in recording seconds. */
export function recordingTimeOf(clock: EpochsClock | null | undefined,
                                index: number, latency: number): number | null {
  if (!clock || index < 0 || index >= clock.onsets.length) return null;
  return clock.onsets[index] - clock.tmin + latency;
}
