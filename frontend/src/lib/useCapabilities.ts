import { useMemo } from "react";
import { useStore } from "../store/store";

/**
 * Capabilities the session currently satisfies: mirrors the backend's
 * `session_capabilities()` so any client control can gate/grey an operation
 * without a round trip. Shared by the command palette and the toolbars that
 * deep-link into it.
 */
export function useCapabilities(): Set<string> {
  const session = useStore((s) => s.session);
  const hasIca = useStore((s) => s.hasIca);
  return useMemo(() => {
    const c = new Set<string>();
    if (!session) return c;
    if (session.has_montage) c.add("montage");
    if ((session.highpass ?? 0) >= 1) c.add("filtered_1hz");
    if (session.bads.length) c.add("has_bads");
    if (hasIca) c.add("ica");
    return c;
  }, [session, hasIca]);
}
