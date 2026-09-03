import { useSyncExternalStore } from "react";

/**
 * Minimal history router — two routes, no dependency.
 *   /   ·   /connect      → Connect
 *   /s/:id                → Workspace
 */
export type Route = { name: "connect" } | { name: "workspace"; sessionId: string };

export function parseRoute(path: string): Route {
  const m = path.match(/^\/s\/([^/]+)/);
  return m ? { name: "workspace", sessionId: decodeURIComponent(m[1]) } : { name: "connect" };
}

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function navigate(path: string, replace = false): void {
  if (path === window.location.pathname + window.location.search) return;
  if (replace) window.history.replaceState(null, "", path);
  else window.history.pushState(null, "", path);
  emit();
}

if (typeof window !== "undefined") {
  window.addEventListener("popstate", emit);
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};
const getSnapshot = () => window.location.pathname;

export function useRoute(): Route {
  const path = useSyncExternalStore(subscribe, getSnapshot, () => "/");
  return parseRoute(path);
}
