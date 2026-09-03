import { useStore } from "./store";

/**
 * A string that changes exactly when the *signal itself* changes — filter
 * bounds, sample rate, sample count, bad-channel set. Panels put it in their
 * fetch deps so they refetch when the underlying data moves, but not on
 * unrelated session edits (e.g. montage name).
 *
 * Single source of truth: previously each panel hand-rolled this and they had
 * drifted (the minimap's copy omitted `bads`, so its RMS envelope went stale
 * whenever a channel was marked bad).
 */
export function useSignatureKey(): string {
  return useStore((s) => {
    const ss = s.session;
    if (!ss) return "";
    return `${ss.highpass}|${ss.lowpass}|${ss.sfreq}|${ss.n_times}|${ss.bads.join(",")}`;
  });
}
