import { toast } from "sonner";
import { Play, Pause, ChevronsLeft, ChevronsRight, Download, GitBranch } from "lucide-react";
import { clsx } from "clsx";
import { api } from "../../api/client";
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
      className="relative h-3.5 flex-1 cursor-pointer rounded-full border border-seam bg-bg"
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

export function ProvenanceStrip() {
  const session = useStore((s) => s.session);
  const playing = useStore((s) => s.playing);
  const setPlaying = useStore((s) => s.setPlaying);
  const pageWindow = useStore((s) => s.pageWindow);
  const t = useStore((s) => s.t);
  const speed = useStore((s) => s.speed);
  const setSpeed = useStore((s) => s.setSpeed);
  const history = useStore((s) => s.history);
  const head = useStore((s) => s.ledgerHead);
  const leaves = useStore((s) => s.leaves);
  const selectedStep = useStore((s) => s.selectedStep);
  const setSelectedStep = useStore((s) => s.setSelectedStep);
  const patchSession = useStore((s) => s.patchSession);
  const refreshHistory = useStore((s) => s.refreshHistory);
  const refreshGraph = useStore((s) => s.refreshGraph);
  const loadLayout = useStore((s) => s.loadLayout);
  const id = session?.session_id;

  const checkout = async (seq: number) => {
    if (!id) return;
    try {
      patchSession(await api.revert(id, seq));
      await Promise.all([refreshHistory(), refreshGraph(), loadLayout()]);
      toast.success(seq === 0 ? "Reverted to pristine" : `Checked out step ${seq}`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const forked = leaves.length > 1;

  return (
    <div className="flex shrink-0 flex-col gap-1 border-t border-seam bg-bg px-2 py-1.5">
      {/* transport */}
      <div className="flex items-center gap-2 text-xs text-fg-dim">
        <button className="rounded-xs border border-seam p-0.5 hover:text-fg" onClick={() => pageWindow(-1)}>
          <ChevronsLeft size={13} />
        </button>
        <button
          className="rounded-xs border border-seam p-0.5 hover:text-fg"
          onClick={() => setPlaying(!playing)}
        >
          {playing ? <Pause size={13} /> : <Play size={13} />}
        </button>
        <button className="rounded-xs border border-seam p-0.5 hover:text-fg" onClick={() => pageWindow(1)}>
          <ChevronsRight size={13} />
        </button>
        <span className="mono shrink-0 tabular-nums text-fg-faint">
          {fmtTime(t)} / {fmtTime(session?.duration_seconds ?? 0)}
        </span>
        <Segmented
          size="xs"
          value={String(speed)}
          onChange={(v) => setSpeed(Number(v))}
          options={[
            { value: "1", label: "1×" },
            { value: "2", label: "2×" },
            { value: "4", label: "4×" },
          ]}
        />
        <Scrubber />
      </div>

      {/* provenance filmstrip */}
      <div className="flex items-center gap-1 overflow-x-auto pb-0.5 text-2xs">
        <button
          onClick={() => checkout(0)}
          className={clsx(
            "shrink-0 rounded-full border px-2 py-0.5",
            head === 0 ? "border-accent text-accent" : "border-seam text-fg-faint hover:text-fg-dim",
          )}
        >
          pristine
        </button>
        {history.map((e) => (
          <div key={e.seq} className="flex shrink-0 items-center gap-1">
            <span className="text-fg-faint">{e.parent !== 0 && e.parent !== e.seq - 1 ? "⋔" : "→"}</span>
            <button
              onClick={() => { setSelectedStep(e.seq); void checkout(e.seq); }}
              title={e.rendered}
              className={clsx(
                "rounded-full border px-2 py-0.5 transition-colors",
                e.seq === head
                  ? "border-accent bg-accent/15 font-medium text-accent"
                  : e.on_path
                    ? "border-seam text-fg-dim hover:text-fg"
                    : "border-dashed border-seam text-fg-faint hover:text-fg-dim",
                selectedStep === e.seq && "ring-1 ring-accent",
              )}
            >
              {e.label.length > 22 ? e.label.slice(0, 21) + "…" : e.label}
            </button>
          </div>
        ))}
        {forked && (
          <span className="ml-1 flex shrink-0 items-center gap-1 text-fg-faint">
            <GitBranch size={10} /> {leaves.length} branches
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1.5 pl-2">
          {id && (
            <a
              href={api.exportPipelineUrl(id)}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 rounded-xs border border-seam px-2 py-0.5 text-fg-dim hover:text-fg"
            >
              <Download size={10} /> pipeline.py
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
