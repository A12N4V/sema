import { Play, Pause, ChevronsLeft, ChevronsRight } from "lucide-react";
import { fmtTime } from "../../lib/plot/scales";
import { useStore } from "../../store/store";
import { Segmented } from "../ui/primitives";

function Scrubber() {
  const session = useStore((s) => s.session);
  const windowStart = useStore((s) => s.windowStart);
  const windowDuration = useStore((s) => s.windowDuration);
  const t = useStore((s) => s.t);
  const setWindow = useStore((s) => s.setWindow);
  const setCursor = useStore((s) => s.setCursor);
  const dur = session?.duration_seconds ?? 1;

  const seek = (clientX: number, el: HTMLElement, cursor: boolean) => {
    const r = el.getBoundingClientRect();
    const time = ((clientX - r.left) / r.width) * dur;
    if (cursor) setCursor(time);
    else setWindow(time - windowDuration / 2);
  };
  return (
    <div
      className="relative h-3 flex-1 cursor-pointer rounded-full border border-seam bg-bg"
      onMouseDown={(e) => seek(e.clientX, e.currentTarget, e.shiftKey)}
      onMouseMove={(e) => e.buttons === 1 && seek(e.clientX, e.currentTarget, e.shiftKey)}
      title="click = move window · shift-click = move cursor"
    >
      <div
        className="absolute top-0 h-full rounded-full bg-fg-faint/25"
        style={{ left: `${(windowStart / dur) * 100}%`, width: `${(windowDuration / dur) * 100}%` }}
      />
      <div className="absolute top-0 h-full w-px bg-accent" style={{ left: `${(t / dur) * 100}%` }} />
    </div>
  );
}

export function Transport() {
  const session = useStore((s) => s.session);
  const playing = useStore((s) => s.playing);
  const setPlaying = useStore((s) => s.setPlaying);
  const pageWindow = useStore((s) => s.pageWindow);
  const t = useStore((s) => s.t);
  const speed = useStore((s) => s.speed);
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
      <Scrubber />
    </div>
  );
}
