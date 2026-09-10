import { useSyncExternalStore } from "react";

/**
 * SSR-safe media query hook. Used to switch between genuinely different
 * layouts (a draggable split vs a stacked scroll) rather than fighting CSS
 * against inline flex-basis math: the split's pixel math only makes sense
 * as a row layout in the first place.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = (cb: () => void) => {
    const mq = window.matchMedia(query);
    mq.addEventListener("change", cb);
    return () => mq.removeEventListener("change", cb);
  };
  const getSnapshot = () => window.matchMedia(query).matches;
  const getServerSnapshot = () => true; // assume desktop before hydration
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
