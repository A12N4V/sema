import { useState } from "react";
import { clsx } from "clsx";
import { FileCode2, ListOrdered, ScrollText, SlidersHorizontal } from "lucide-react";
import { useNarrow } from "../lib/useMedia";
import { Stages } from "../panes/Stages";
import { Params } from "../panes/Params";
import { Log } from "../panes/Log";
import { Source } from "../panes/Source";

type Pane = "stages" | "log" | "source" | "params";
const PANES: { id: Pane; label: string; icon: typeof ScrollText }[] = [
  { id: "stages", label: "Stages", icon: ListOrdered }, { id: "log", label: "Log", icon: ScrollText },
  { id: "source", label: "Source", icon: FileCode2 }, { id: "params", label: "Parameters", icon: SlidersHorizontal },
];

/**
 * The method itself: stages of the original code, its log, its source, its
 * configuration. Three panes side by side on a desk; one at a time, chosen by
 * a tab row, on a phone.
 */
export function PipelinePage() {
  const narrow = useNarrow();
  const [stage, setStage] = useState<string | null>(null);
  const [pane, setPane] = useState<Pane>("stages");
  const [center, setCenter] = useState<"log" | "source">("log");

  if (narrow) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex h-8 shrink-0 items-stretch border-b border-seam" role="tablist">
          {PANES.map((p) => (
            <button key={p.id} role="tab" aria-selected={pane === p.id} onClick={() => setPane(p.id)}
                    className={clsx("flex flex-1 items-center justify-center gap-1 border-b text-xs",
                      pane === p.id ? "border-accent text-fg" : "border-transparent text-fg-faint")}>
              <p.icon size={12} />{p.label}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1">
          {pane === "stages" && <Stages stage={stage} setStage={(s) => { setStage(s); }} />}
          {pane === "log" && <Log />}
          {pane === "source" && <Source stage={stage} />}
          {pane === "params" && <Params />}
        </div>
      </div>
    );
  }
  return (
    <div className="grid h-full min-h-0 grid-cols-[15rem_minmax(0,1fr)_19rem]">
      <div className="min-h-0 border-r border-seam"><Stages stage={stage} setStage={(s) => { setStage(s); if (s) setCenter("source"); }} /></div>
      <div className="flex min-h-0 flex-col">
        <div className="flex h-8 shrink-0 items-stretch gap-0.5 border-b border-seam px-1.5">
          {(["log", "source"] as const).map((c) => {
            const P = PANES.find((p) => p.id === c)!;
            return (
              <button key={c} onClick={() => setCenter(c)}
                      className={clsx("flex items-center gap-1.5 border-b px-2.5 text-sm", center === c ? "border-accent text-fg" : "border-transparent text-fg-faint hover:text-fg-dim")}>
                <P.icon size={12} />{P.label}
              </button>
            );
          })}
        </div>
        <div className="min-h-0 flex-1">{center === "log" ? <Log /> : <Source stage={stage} />}</div>
      </div>
      <div className="min-h-0 border-l border-seam"><Params /></div>
    </div>
  );
}
