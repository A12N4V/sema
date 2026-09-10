import { type ReactNode } from "react";
import clsx from "clsx";
import { AlertTriangle, Loader2, Maximize2, Minimize2 } from "lucide-react";
import { AutoBadge, AutoStrip } from "./AutoDerived";
import { useDerivation } from "../../lib/derivation";
import { useStore } from "../../store/store";
import type { PanelState } from "./usePanelData";

interface Props {
  title: string;
  state?: PanelState;
  error?: string | null;
  right?: ReactNode;      // header-right controls, kept when maximized
  children: ReactNode;
  /** message to show when there's no data at all yet */
  emptyHint?: string;
  /**
   * Stable id for the maximize control. When set, the pane gets a button that
   * blows it up to fill the whole main area (and back). The pane keeps all of
   * its own controls either way: only its box changes.
   */
  paneId?: string;
  /**
   * Which container this pane is showing ("ica", "epochs", "evoked", "tfr").
   * When the backend reports that container as auto-derived, the pane grows a
   * disclaimer strip and a warning triangle: everything on it was this
   * program's idea, and it has to say so.
   */
  container?: string;
}

export function Panel({ title, state = "ready", error, right, children, emptyHint, paneId, container }: Props) {
  const derivation = useDerivation(container);
  const maximized = useStore((s) => s.maximized);
  const toggleMaximized = useStore((s) => s.toggleMaximized);
  const isMax = !!paneId && maximized === paneId;

  return (
    <div className="flex h-full w-full flex-col bg-panel">
      <header
        className="flex h-7 shrink-0 items-center justify-between border-b border-seam px-2.5 text-xs"
        onDoubleClick={paneId ? () => toggleMaximized(paneId) : undefined}
      >
        {/* `flex-1` with a floor, not bare `min-w-0`: the group on the right was
            `shrink-0`, so on a narrow viewport it took the whole header and the
            title collapsed to zero width. Truncated to a few characters is a
            legible pane; gone entirely is a pane that no longer says what it is. */}
        <div className="flex min-w-[7ch] flex-1 items-center gap-1.5">
          <span className="truncate font-medium tracking-tight text-fg-dim">{title}</span>
          {state === "loading" && <Loader2 size={11} className="shrink-0 animate-spin text-fg-faint" />}
          {state === "stale" && <span className="h-1 w-1 shrink-0 rounded-full bg-warn" />}
        </div>
        <div className="flex min-w-0 shrink items-center gap-2 overflow-hidden text-fg-dim">
          {right}
          {/* left of the expand button, so the "how was this made?" affordance
              is adjacent to the pane's own controls rather than lost in them */}
          {derivation && <AutoBadge derivation={derivation} />}
          {paneId && (
            <button
              onClick={() => toggleMaximized(paneId)}
              title={isMax ? "Restore  (Esc)" : `Expand ${title} to fill the window`}
              aria-label={isMax ? "Restore pane" : "Expand pane"}
              aria-pressed={isMax}
              className={clsx(
                "-mr-1 rounded-xs p-1 transition-colors",
                isMax ? "text-accent hover:bg-accent/10" : "text-fg-faint hover:bg-panel-2 hover:text-fg",
              )}
            >
              {isMax ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
            </button>
          )}
        </div>
      </header>

      {derivation && <AutoStrip derivation={derivation} />}

      <div className="relative min-h-0 flex-1">
        <DataGate state={state} error={error} emptyHint={emptyHint}>{children}</DataGate>
      </div>
    </div>
  );
}

/**
 * The error/loading/ready switch a `Panel` runs internally, pulled out so a
 * pane with several data-driven sub-views (tabs sharing one header) can gate
 * each sub-view the same way without a `Panel` of its own.
 */
export function DataGate({
  state = "ready",
  error,
  emptyHint,
  children,
}: {
  state?: PanelState;
  error?: string | null;
  emptyHint?: string;
  children: ReactNode;
}) {
  if (state === "error") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-fg-dim">
        <AlertTriangle size={16} className="text-alert" />
        <span className="text-xs">{error ?? "Something went wrong"}</span>
      </div>
    );
  }
  if (state === "loading" && emptyHint) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-xs text-fg-faint">
        {emptyHint}
      </div>
    );
  }
  return <div className={clsx("h-full w-full", state === "stale" ? "is-stale" : "is-ready")}>{children}</div>;
}
