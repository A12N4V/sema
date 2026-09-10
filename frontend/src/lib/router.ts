import { useSyncExternalStore } from "react";

/**
 * Minimal history router: no dependency.
 *   /   ·   /connect                     → Connect
 *   /s/:id[/<container>]                  → Workspace, one surface
 *
 * The path segment is the **container** being looked at, not a "page": that is
 * the v6 model, where the noun axis (which MNE object) is the bottom strip and
 * the verb axis (what to do to it) is the ribbon. `analysis` is kept as an
 * alias for `source` so older links still resolve.
 */
export const PAGES = ["signal", "channels", "ica", "epochs", "evoked", "tfr", "source", "pipeline"] as const;
export type Page = (typeof PAGES)[number];

/** Retired names → where they live now. */
const ALIASES: Record<string, Page> = {
  analysis: "source",
  raw: "signal",
  annotations: "channels",   // one workspace holds both
  timefreq: "tfr",
};

export type Route =
  | { name: "connect" }
  | { name: "workspace"; sessionId: string; page: Page };

const toPage = (v: string | undefined): Page => {
  if (!v) return "signal";
  if ((PAGES as readonly string[]).includes(v)) return v as Page;
  return ALIASES[v] ?? "signal";
};

export function parseRoute(path: string): Route {
  const m = path.match(/^\/s\/([^/]+)(?:\/([^/]+))?/);
  if (!m) return { name: "connect" };
  return {
    name: "workspace",
    sessionId: decodeURIComponent(m[1]),
    page: toPage(m[2]),
  };
}

/** Canonical path for a session surface. */
export const sessionPath = (sessionId: string, page: Page = "signal") =>
  `/s/${encodeURIComponent(sessionId)}/${page}`;

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
