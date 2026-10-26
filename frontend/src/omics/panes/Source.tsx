import { useEffect, useState } from "react";
import { clsx } from "clsx";
import { api } from "../api";
import { useStore, useWorkflow } from "../store";

export function Source({ stage }: { stage: string | null }) {
  const wf = useWorkflow()!;
  const engine = useStore((s) => s.engine[s.wfId] ?? wf.engines[0]);
  const sid = stage ?? wf.stages[0].id;
  const [src, setSrc] = useState("");
  useEffect(() => { api.source(wf.id, sid, engine).then(setSrc); }, [wf.id, sid, engine]);
  const where = engine === "R" ? `workflows/bulk-r/${sid}.R` : engine === "python" ? `workflows/bulk-py/${sid}.py`
    : `notebook cells ${wf.stages.find((s) => s.id === sid)?.cells.join(", ")}`;
  return (
    <div className="h-full overflow-auto">
      <div className="sticky top-0 border-b border-seam bg-bg px-3 py-1 text-2xs text-fg-faint">{where} · read only</div>
      <pre className="code p-3">
        {src.split("\n").map((l, i) => (
          <div key={i} className="flex">
            <span className="w-9 shrink-0 select-none pr-3 text-right text-fg-faint">{i + 1}</span>
            <span className={clsx("whitespace-pre", /^\s*#/.test(l) ? "text-fg-faint" : "text-fg-dim")}>{l || " "}</span>
          </div>
        ))}
      </pre>
    </div>
  );
}
