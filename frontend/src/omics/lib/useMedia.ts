import { useSyncExternalStore } from "react";

export function useMedia(q: string): boolean {
  return useSyncExternalStore(
    (cb) => { const m = matchMedia(q); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); },
    () => matchMedia(q).matches,
    () => false,
  );
}

/** Below this the shell shows one pane at a time. */
export const useNarrow = () => useMedia("(max-width: 899px)");
