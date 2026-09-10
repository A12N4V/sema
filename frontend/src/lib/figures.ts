/**
 * The client half of the precomputed figure pipeline.
 *
 * Every server-rendered PNG in the app comes through here instead of each pane
 * fetching and revoking its own object URL. That buys three things:
 *
 *  - **one blob per figure.** Four panes showing the alpha topomap share it.
 *  - **an instant answer while scrubbing.** `peek()` returns the nearest
 *    already-in-memory frame synchronously, so the pane paints the frame at
 *    the grid time immediately and swaps in the exact one when it arrives.
 *    Which time you are looking at is never ambiguous, the server bakes
 *    `t = 3.30 s` into the figure itself.
 *  - **one lifetime.** Object URLs are revoked as a generation, when the
 *    session, the signal or the theme moves, rather than per component unmount.
 *
 * The server's matching half is core/precompute.py, it renders the same frame
 * grid, so a request for a grid time is a file read on both sides.
 */
import { api } from "../api/client";

/** Must match FRAME_SIZE in backend/app/core/precompute.py, or nothing is cached. */
export const FRAME_SIZE = 400;

export type Spec = Record<string, unknown>;

const urls = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();
let generation = "";

export function figureKey(spec: Spec): string {
  return Object.keys(spec)
    .sort()
    .map((k) => `${k}=${String(spec[k])}`)
    .join("&");
}

/**
 * Identify the current signal/theme/session. Changing it drops every cached
 * figure: they were drawn from data or in a palette that no longer applies.
 */
export function setGeneration(next: string): void {
  if (next === generation) return;
  generation = next;
  for (const url of urls.values()) URL.revokeObjectURL(url);
  urls.clear();
  inflight.clear();
}

/** An already-loaded figure, or undefined. Synchronous, safe to call in render. */
export function peek(spec: Spec): string | undefined {
  return urls.get(figureKey(spec));
}

export async function figure(sessionId: string, spec: Spec): Promise<string> {
  const key = figureKey(spec);
  const hit = urls.get(key);
  if (hit) return hit;

  let pending = inflight.get(key);
  if (!pending) {
    const gen = generation;
    pending = api.render(sessionId, spec).then(
      (url) => {
        inflight.delete(key);
        if (gen !== generation) {
          URL.revokeObjectURL(url); // arrived after the signal moved on
          return url;
        }
        urls.set(key, url);
        return url;
      },
      (e) => {
        inflight.delete(key);
        throw e;
      },
    );
    inflight.set(key, pending);
  }
  return pending;
}

/**
 * Pull a list of figures into memory in the background. Bounded concurrency:
 * the point is to be finished before the user scrubs, not to saturate the
 * connection and make the pane they are looking at wait behind 180 frames.
 */
export async function prefetch(
  sessionId: string,
  specs: Spec[],
  onProgress?: (fraction: number) => void,
): Promise<void> {
  const gen = generation;
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < specs.length && gen === generation) {
      const spec = specs[next++];
      try {
        await figure(sessionId, spec);
      } catch {
        /* one unrenderable frame must not stop the strip */
      }
      onProgress?.(++done / specs.length);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
}

/** The frame-grid time closest to `t`. Returns `t` when there is no grid. */
export function nearestFrame(times: number[], t: number): number {
  if (!times.length) return t;
  let lo = 0;
  let hi = times.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) lo = mid;
    else hi = mid;
  }
  return Math.abs(times[lo] - t) <= Math.abs(times[hi] - t) ? times[lo] : times[hi];
}
