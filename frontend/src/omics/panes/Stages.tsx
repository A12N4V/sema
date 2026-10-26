import { clsx } from "clsx";
import { stageNum, type StageState } from "../api";
import { useStore, useWorkflow } from "../store";
import { PaneHead } from "../ui/primitives";

export function Stages({ stage, setStage }: { stage: string | null; setStage: (s: string | null) => void }) {
  const wf = useWorkflow()!;
  const run = useStore((s) => s.run);
  return (
    <aside className="flex h-full min-h-0 flex-col bg-bg">
      <PaneHead title="Stages" sub={wf.design} />
      <ol className="min-h-0 flex-1 overflow-y-auto py-1">
        {wf.stages.map((s) => {
          const st: StageState = run?.stages[s.id] ?? "pending";
          return (
            <li key={s.id}>
              <button onClick={() => setStage(stage === s.id ? null : s.id)}
                      className={clsx("group flex w-full items-start gap-2 px-3 py-1.5 text-left transition-colors", stage === s.id ? "bg-panel-2" : "hover:bg-panel")}>
                <span className={clsx("dot mt-[5px]", `dot-${st}`)} title={st} />
                <span className="mono w-7 shrink-0 pt-px text-2xs text-fg-faint">{stageNum(s.id)}</span>
                <span className="min-w-0 flex-1">
                  <span className={clsx("block text-sm", stage === s.id ? "text-fg" : "text-fg-dim group-hover:text-fg")}>{s.title}</span>
                  {stage === s.id && <span className="mt-0.5 block text-xs leading-snug text-fg-faint">{s.summary}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
