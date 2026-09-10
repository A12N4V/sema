import { useState } from "react";
import { AlertTriangle, X, Info } from "lucide-react";
import { type Derivation } from "../../lib/derivation";

/**
 * The warning triangle, and the dialog behind it.
 *
 * Sits in the pane header, immediately left of the expand button. It appears
 * only on panes whose contents this program produced on its own initiative:
 * ICA that nobody asked to fit, trials nobody chose the boundaries of. Those
 * panes are useful, and they are also a set of defaults wearing the costume of
 * a result. The triangle is the seam between the two, and the dialog is where
 * every assumption is written down in full.
 */
export function AutoBadge({ derivation }: { derivation: Derivation }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Generated automatically. See what was assumed."
        aria-label="Show the assumptions behind this figure"
        className="rounded-xs p-1 text-warn transition-colors hover:bg-warn/15"
      >
        <AlertTriangle size={12} />
      </button>
      {open && <AssumptionsDialog derivation={derivation} onClose={() => setOpen(false)} />}
    </>
  );
}

function AssumptionsDialog({ derivation, onClose }: { derivation: Derivation; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg/70 p-4 backdrop-blur-[2px]"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="How this was generated"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[80vh] w-full max-w-[560px] overflow-y-auto rounded-sm border border-seam-bright bg-panel shadow-2xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-seam px-4 py-3">
          <div className="flex items-start gap-2.5">
            <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warn" />
            <div>
              <h2 className="text-md font-medium text-fg">Generated automatically</h2>
              <p className="mt-0.5 text-xs text-fg-dim">{derivation.label}</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close"
                  className="-mr-1 rounded-xs p-1 text-fg-faint transition-colors hover:bg-panel-2 hover:text-fg">
            <X size={14} />
          </button>
        </header>

        <div className="px-4 py-3">
          <div className="mb-1.5 text-2xs uppercase tracking-wide text-fg-faint">What was run</div>
          <pre className="mono overflow-x-auto rounded-xs border border-seam bg-bg px-3 py-2 text-2xs leading-relaxed text-fg-dim">
{derivation.call}
          </pre>

          <div className="mb-1.5 mt-4 text-2xs uppercase tracking-wide text-fg-faint">
            What it assumed
          </div>
          <ul className="flex flex-col gap-1.5">
            {derivation.assumptions.map((a, i) => (
              <li key={i} className="flex gap-2 text-xs leading-relaxed text-fg-dim">
                <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-warn/70" />
                <span>{a}</span>
              </li>
            ))}
          </ul>

          <div className="mt-4 flex items-start gap-2 rounded-xs border border-seam bg-panel-2/60 p-2.5">
            <Info size={12} className="mt-0.5 shrink-0 text-fg-faint" />
            <p className="text-2xs leading-relaxed text-fg-dim">
              None of this is in your pipeline. It was computed on a copy so you would have
              something to look at, and it is <span className="text-fg">not</span> a ledger step:
              <code className="mono mx-1 text-fg-dim">pipeline.py</code> still contains only what
              you ran. Run the operation yourself, with your own parameters, to make it yours.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The one-line disclaimer, directly under the pane header.
 *
 * Deliberately a strip rather than a toast: a toast is dismissed and forgotten,
 * and this has to stay true for as long as the figure is on screen.
 */
export function AutoStrip({ derivation }: { derivation: Derivation }) {
  return (
    <div className="flex shrink-0 items-center gap-1.5 border-b border-warn/25 bg-warn/[0.07] px-2.5 py-1 text-2xs text-fg-dim">
      <AlertTriangle size={10} className="shrink-0 text-warn" />
      <span className="truncate">
        <span className="text-warn">Automatic:</span> {derivation.label}. Not part of your pipeline.
      </span>
    </div>
  );
}
