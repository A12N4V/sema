import { Play, Pause, ChevronsLeft, ChevronsRight } from "lucide-react";
import { fmtTime } from "../../lib/plot/scales";
import { useStore } from "../../store/store";
import { Segmented } from "../ui/primitives";

export function Transport() {
  const session = useStore((s) => s.session);
  const playing = useStore((s) => s.playing);
  const setPlaying = useStore((s) => s.setPlaying);
  const pageWindow = useStore((s) => s.pageWindow);
  const t = useStore((s) => s.t);
  const speed = useStore((s) => s.speed);
  const windowDuration = useStore((s) => s.windowDuration);
  const setSpeed = useStore((s) => s.setSpeed);

  return (
    <div className="flex items-center gap-2 border-t border-seam bg-bg px-2 py-1.5 text-xs text-fg-dim">
      <button className="rounded-xs border border-seam p-0.5 hover:text-fg" onClick={() => pageWindow(-1)}>
        <ChevronsLeft size={12} />
      </button>
      <button className="rounded-xs border border-seam p-0.5 hover:text-fg" onClick={() => setPlaying(!playing)}>
        {playing ? <Pause size={12} /> : <Play size={12} />}
      </button>
      <button className="rounded-xs border border-seam p-0.5 hover:text-fg" onClick={() => pageWindow(1)}>
        <ChevronsRight size={12} />
      </button>
      <span className="mono shrink-0 tabular-nums text-fg-faint">
        {fmtTime(t)} / {fmtTime(session?.duration_seconds ?? 0)}
      </span>
      <Segmented
        size="xs"
        value={String(speed)}
        onChange={(v) => setSpeed(Number(v))}
        options={[{ value: "1", label: "1×" }, { value: "2", label: "2×" }, { value: "4", label: "4×" }]}
      />
      <span className="mono ml-auto truncate text-2xs text-fg-faint max-[1100px]:hidden">
        {windowDuration.toFixed(0)}s window · drag the strip below to move it
      </span>
    </div>
  );
}
