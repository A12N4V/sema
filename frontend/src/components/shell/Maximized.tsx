import type { ReactNode } from "react";
import { useStore } from "../../store/store";

/**
 * A pane blown up to fill the page. The pane renders exactly as it does in the
 * grid: same component, same controls, same header (whose control now reads
 * "restore"): so nothing is lost by expanding it.
 */
export function Maximized({ children }: { title?: string; children: ReactNode }) {
  const setMaximized = useStore((s) => s.setMaximized);
  return (
    <div className="relative h-full min-h-0 w-full">
      {children}
      <button
        onClick={() => setMaximized(null)}
        className="absolute bottom-2 left-1/2 z-20 -translate-x-1/2 rounded-full border border-seam bg-panel/90
                   px-2.5 py-1 text-2xs text-fg-faint backdrop-blur transition-colors hover:text-fg"
      >
        Esc to restore
      </button>
    </div>
  );
}
