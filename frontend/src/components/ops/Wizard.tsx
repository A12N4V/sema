import { useState, type ReactNode } from "react";
import { Check, ChevronRight, X, Loader2 } from "lucide-react";
import { clsx } from "clsx";

export interface WizardStep {
  id: string;
  title: string;
  /** true once this step's prerequisite is met */
  done: boolean;
  /** render the step body; call onComplete() when the action finishes */
  body: (ctx: { next: () => void }) => ReactNode;
  /** hidden entirely (e.g. a step that doesn't apply) */
  skip?: boolean;
}

/**
 * A gated multi-step flow . Steps show as a
 * checklist; the first not-done step is expanded. Used for source setup,
 * BIDS export, epoching: anything with prerequisites.
 */
export function Wizard({
  title,
  steps,
  onClose,
  busy = false,
}: {
  title: string;
  steps: WizardStep[];
  onClose: () => void;
  busy?: boolean;
}) {
  const live = steps.filter((s) => !s.skip);
  const firstPending = live.findIndex((s) => !s.done);
  const [open, setOpen] = useState<string | null>(null);
  const expanded = open ?? (firstPending >= 0 ? live[firstPending].id : null);

  return (
    <div className="pop w-[420px] overflow-hidden">
      <header className="flex items-center justify-between border-b border-seam px-4 py-2.5">
        <span className="text-md font-semibold text-fg">{title}</span>
        <button onClick={onClose} className="rounded-xs p-0.5 text-fg-faint hover:bg-panel-2 hover:text-fg">
          <X size={15} />
        </button>
      </header>
      <div className="flex flex-col gap-1 p-2">
        {live.map((s, i) => {
          const isOpen = expanded === s.id;
          return (
            <div key={s.id} className="rounded-xs border border-seam">
              <button
                onClick={() => setOpen(isOpen ? "" : s.id)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
              >
                <span
                  className={clsx(
                    "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-2xs",
                    s.done ? "border-good bg-good/15 text-good" : "border-seam text-fg-faint",
                  )}
                >
                  {s.done ? <Check size={10} /> : i + 1}
                </span>
                <span className={clsx("flex-1", s.done ? "text-fg-dim" : "text-fg")}>{s.title}</span>
                {busy && isOpen ? (
                  <Loader2 size={12} className="animate-spin text-fg-faint" />
                ) : (
                  <ChevronRight size={13} className={clsx("text-fg-faint transition-transform", isOpen && "rotate-90")} />
                )}
              </button>
              {isOpen && (
                <div className="border-t border-seam px-3 py-2.5">
                  {s.body({ next: () => setOpen("") })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
