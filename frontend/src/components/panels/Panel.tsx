import { type ReactNode } from "react";
import clsx from "clsx";
import { AlertTriangle, Loader2 } from "lucide-react";
import type { PanelState } from "./usePanelData";

interface Props {
  title: string;
  fkey?: string;
  state?: PanelState;
  error?: string | null;
  right?: ReactNode;      // header-right controls
  children: ReactNode;
  /** message to show when there's no data at all yet */
  emptyHint?: string;
}

export function Panel({ title, state = "ready", error, right, children, emptyHint }: Props) {
  return (
    <div className="flex h-full w-full flex-col bg-panel">
      <header className="flex h-7 shrink-0 items-center justify-between border-b border-seam px-2.5 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="font-medium tracking-tight text-fg-dim">{title}</span>
          {state === "loading" && <Loader2 size={11} className="animate-spin text-fg-faint" />}
          {state === "stale" && <span className="h-1 w-1 rounded-full bg-warn" />}
        </div>
        <div className="flex items-center gap-2 text-fg-dim">{right}</div>
      </header>

      <div className="relative min-h-0 flex-1">
        {state === "error" ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-fg-dim">
            <AlertTriangle size={16} className="text-alert" />
            <span className="text-xs">{error ?? "Something went wrong"}</span>
          </div>
        ) : state === "loading" && emptyHint ? (
          <div className="flex h-full items-center justify-center p-4 text-center text-xs text-fg-faint">
            {emptyHint}
          </div>
        ) : (
          <div className={clsx("h-full w-full", state === "stale" ? "is-stale" : "is-ready")}>
            {children}
          </div>
        )}
      </div>
    </div>
  );
}
