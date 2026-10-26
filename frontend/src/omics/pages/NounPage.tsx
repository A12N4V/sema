import { useEffect } from "react";
import { clsx } from "clsx";
import { Activity, Image as ImageIcon, Table2 } from "lucide-react";
import { api, fmtBytes, type NounEntry } from "../api";
import { useStore } from "../store";
import { useNarrow } from "../lib/useMedia";
import { Empty } from "../ui/primitives";
import { FigureCard } from "../figures/FigureCard";
import { LiveBar } from "../shell/LiveBar";

/**
 * A noun: one figure large, everything else this kind of result produced in a
 * rail beside it (below it on a phone, as a sideways filmstrip). Interactive
 * figures first, then the scripts' saved images, then their tables.
 */
export function NounPage({ noun }: { noun: NounEntry }) {
  const wfId = useStore((s) => s.wfId);
  const runId = useStore((s) => s.runId);
  const maximized = useStore((s) => s.maximized);
  const narrow = useNarrow();
  const stored = useStore((s) => s.focus[`${wfId}:${noun.id}`]);
  const items = [
    ...noun.figures.map((f) => `fig:${f.id}`),
    ...noun.static.map((p) => `img:${p}`),
    ...noun.tables.map((t) => `tab:${t.path}`),
  ];
  const focus = stored && items.includes(stored) ? stored : items[0];
  useEffect(() => { if (focus && focus !== stored) useStore.getState().setFocus(noun.id, focus); }, [focus, stored, noun.id]);

  if (!items.length) return <Empty>Nothing here yet: {noun.hint}.</Empty>;
  const pick = (f: string) => useStore.getState().setFocus(noun.id, f);

  const rail = (
    <nav aria-label={`${noun.label} contents`}
         className={clsx("shrink-0 bg-bg", narrow
           ? "no-scrollbar flex h-[76px] gap-1.5 overflow-x-auto border-t border-seam p-1.5"
           : "flex w-60 flex-col overflow-y-auto border-l border-seam py-1")}>
      {!narrow && noun.figures.length > 0 && <RailHead label="Interactive" />}
      {noun.figures.map((f) => (
        <RailItem key={f.id} active={focus === `fig:${f.id}`} onClick={() => pick(`fig:${f.id}`)} narrow={narrow}
                  icon={<Activity size={12} />} label={f.title} sub={f.kind} />
      ))}
      {!narrow && noun.static.length > 0 && <RailHead label={`Saved figures · ${noun.static.length}`} />}
      {noun.static.map((p) => (
        <RailItem key={p} active={focus === `img:${p}`} onClick={() => pick(`img:${p}`)} narrow={narrow}
                  thumb={runId ? api.fileUrl(runId, p) : undefined} icon={<ImageIcon size={12} />}
                  label={p.split("/").pop()!.replace(/\.(png|svg)$/, "")} />
      ))}
      {!narrow && noun.tables.length > 0 && <RailHead label={`Tables · ${noun.tables.length}`} />}
      {noun.tables.map((t) => (
        <RailItem key={t.path} active={focus === `tab:${t.path}`} onClick={() => pick(`tab:${t.path}`)} narrow={narrow}
                  icon={<Table2 size={12} />} label={t.path.split("/").pop()!} sub={fmtBytes(t.bytes)} />
      ))}
      {!narrow && noun.downloads.length > 0 && <RailHead label="Downloads" />}
      {!narrow && noun.downloads.map((d) => (
        <a key={d.path} href={runId ? api.fileUrl(runId, d.path) : undefined} download
           className="mono flex items-baseline gap-2 px-3 py-1 text-2xs text-fg-faint hover:text-accent">
          <span className="min-w-0 flex-1 truncate">{d.path.split("/").pop()}</span><span>{fmtBytes(d.bytes)}</span>
        </a>
      ))}
    </nav>
  );

  return (
    <div className={clsx("flex h-full min-h-0", narrow ? "flex-col" : "flex-row")}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1">{focus && <FigureCard noun={noun.id} focus={focus} figs={noun.figures} />}</div>
        {focus.startsWith("fig:") && <LiveBar noun={noun} />}
      </div>
      {!maximized && rail}
    </div>
  );
}

const RailHead = ({ label }: { label: string }) => (
  <div className="mt-2 px-3 pb-1 text-2xs uppercase tracking-[0.12em] text-fg-faint first:mt-1">{label}</div>
);

function RailItem({ active, onClick, icon, label, sub, thumb, narrow }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string; sub?: string; thumb?: string; narrow: boolean;
}) {
  if (narrow) {
    return (
      <button onClick={onClick} title={label}
              className={clsx("flex w-24 shrink-0 flex-col overflow-hidden rounded-sm border text-left",
                active ? "border-accent" : "border-seam")}>
        <span className="thumb flex h-10 items-center justify-center text-fg-faint">
          {thumb ? <img src={thumb} alt="" loading="lazy" className="h-full w-full object-cover" /> : icon}
        </span>
        <span className="mono truncate px-1 py-0.5 text-[9px] text-fg-dim">{label}</span>
      </button>
    );
  }
  return (
    <button onClick={onClick} title={label}
            className={clsx("flex w-full items-center gap-2 px-3 py-1 text-left transition-colors",
              active ? "bg-panel-2 text-fg" : "text-fg-dim hover:bg-panel hover:text-fg")}>
      {thumb
        ? <img src={thumb} alt="" loading="lazy" className="thumb h-7 w-10 shrink-0 rounded-xs object-cover" />
        : <span className={clsx("flex h-7 w-10 shrink-0 items-center justify-center rounded-xs border", active ? "border-accent/60 text-accent" : "border-seam text-fg-faint")}>{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs">{label}</span>
        {sub && <span className="mono block truncate text-2xs text-fg-faint">{sub}</span>}
      </span>
    </button>
  );
}
