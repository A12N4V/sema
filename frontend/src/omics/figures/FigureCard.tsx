import { useEffect, useMemo, useRef, useState } from "react";
import { clsx } from "clsx";
import { BoxSelect, Download, Loader2, Maximize2, Minimize2, Minus, Plus, RotateCcw, Settings2, X } from "lucide-react";
import { api, type FigureRef } from "../api";
import { useStore } from "../store";
import { useNarrow } from "../lib/useMedia";
import { Empty, IconBtn } from "../ui/primitives";
import { RENDERERS } from "./kinds";
import { defaults } from "./settings";
import { FigureSettings } from "./FigureSettings";
import { StaticFigure } from "./StaticFigure";
import { useSpec } from "./useSpec";
import { TableView } from "../panes/TableView";

/** Download whatever canvas is inside `el` as a PNG on the theme ground. */
export function downloadCanvas(el: HTMLElement | null, name: string) {
  const c = el?.querySelector("canvas");
  if (!c) return;
  const out = document.createElement("canvas");
  out.width = c.width; out.height = c.height;
  const ctx = out.getContext("2d")!;
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--color-panel").trim() || "#0a0b0e";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(c, 0, 0);
  const a = document.createElement("a");
  a.href = out.toDataURL("image/png"); a.download = `${name}.png`; a.click();
}

/**
 * The card in the middle of a noun page: one interactive figure, saved image or
 * table, with its controls in the header. Sema's pane anatomy: title on the
 * left, verbs on the right, the figure owning everything below.
 */
export function FigureCard({ noun, focus, figs }: { noun: string; focus: string; figs: FigureRef[] }) {
  const [type, ...rest] = focus.split(":");
  const ref = rest.join(":");
  const fig = type === "fig" ? figs.find((f) => f.id === ref) ?? null : null;
  const wfId = useStore((s) => s.wfId);
  const runId = useStore((s) => s.runId)!;
  const maximized = useStore((s) => s.maximized);
  const gene = useStore((s) => s.gene);
  const narrow = useNarrow();
  const fkey = `${wfId}:${noun}:${fig?.id}`;
  const variant = useStore((s) => s.variant[fkey]);
  const fetched = useSpec(noun, fig?.id ?? null, fig?.kind);
  // a live recompute (samples excluded, UMAP by gene) replaces the saved figure until cleared
  const live = useStore((s) => (fig ? s.live[`${runId}:${fig.id}`] : undefined));
  const { err, loading } = fetched;
  const spec = live ?? fetched.spec;
  const saved = useStore((s) => (spec ? s.settings[`${wfId}:${spec.kind}:${fig?.id}`] : undefined));
  const settings = useMemo(() => (spec ? { ...defaults(spec), ...(saved ?? {}) } : {}), [spec, saved]);
  const [gear, setGear] = useState(false);
  const [imgCmd, setImgCmd] = useState<{ op: string; n: number } | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const zkey = `${fkey}:${variant ?? ""}${live ? ":live" : ""}`;
  const skey = spec ? `${wfId}:${spec.kind}:${fig?.id}` : "";

  // the ribbon's Figure tab edits whatever is in front of you
  useEffect(() => {
    useStore.getState().set({ active: spec && fig ? { spec, skey, zkey } : null });
    return () => useStore.getState().set({ active: null });
  }, [spec, fig, skey, zkey]);

  const z = (op: "in" | "out" | "reset" | "box") => (type === "img" ? setImgCmd({ op, n: Date.now() }) : useStore.getState().zoom(zkey, op));
  const title = fig ? fig.title : ref.split("/").pop();
  const variants = spec?.variants ?? fig?.variants ?? [];
  const Renderer = spec ? RENDERERS[spec.kind] : null;

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col bg-bg">
      <header className="flex h-9 shrink-0 items-center gap-1 border-b border-seam pl-3 pr-1">
        <span className="min-w-0 truncate text-sm font-medium text-fg">{title}</span>
        {spec?.subtitle && <span className="mono truncate text-2xs text-fg-faint">{spec.subtitle}</span>}
        {live && (
          <button onClick={() => useStore.getState().setLive(`${runId}:${fig!.id}`, null)} title="Back to the saved figure"
                  className="mono flex shrink-0 items-center gap-1 rounded-xs border border-accent/60 px-1.5 py-0.5 text-2xs text-accent hover:bg-accent/10">
            live{live.exact ? "" : " · approx"} · {live.ms} ms <X size={10} />
          </button>
        )}
        {fig?.kind === "gene" && <span className="mono truncate text-2xs text-accent">{spec?.gene ?? gene}</span>}
        {variants.length > 0 && (
          <select value={variant ?? spec?.variant ?? variants[0]} aria-label="Variant"
                  onChange={(e) => useStore.getState().setVariant(fkey, e.target.value)}
                  className="mono ml-1 h-6 max-w-40 shrink rounded-sm border border-seam bg-bg px-1 text-2xs text-fg-dim">
            {variants.map((v: string) => <option key={v} value={v}>{v}</option>)}
          </select>
        )}
        {loading && <Loader2 size={12} className="ml-1 shrink-0 animate-spin text-fg-faint" />}
        <span className="flex-1" />
        {type !== "tab" && (
          <>
            {type === "fig" && <IconBtn label="Box zoom" onClick={() => z("box")}><BoxSelect size={13} /></IconBtn>}
            <IconBtn label="Zoom out" onClick={() => z("out")}><Minus size={13} /></IconBtn>
            <IconBtn label="Zoom in" onClick={() => z("in")}><Plus size={13} /></IconBtn>
            <IconBtn label="Reset view" onClick={() => z("reset")}><RotateCcw size={12} /></IconBtn>
          </>
        )}
        {type === "fig" && spec && (
          <IconBtn label="Figure settings" active={gear} onClick={() => setGear((g) => !g)}><Settings2 size={13} /></IconBtn>
        )}
        {type === "fig" && <IconBtn label="Download PNG" onClick={() => downloadCanvas(body.current, `${noun}-${fig?.id}`)}><Download size={13} /></IconBtn>}
        {type !== "fig" && <a href={api.fileUrl(runId, ref)} download aria-label="Download" title="Download"
                              className="flex h-6 w-6 items-center justify-center rounded-sm text-fg-faint hover:bg-panel-2 hover:text-fg"><Download size={13} /></a>}
        {!narrow && (
          <IconBtn label={maximized ? "Restore" : "Maximise"} onClick={() => useStore.getState().set({ maximized: !maximized })}>
            {maximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </IconBtn>
        )}
      </header>
      <div ref={body} className="relative min-h-0 flex-1">
        {type === "img" && <StaticFigure src={api.fileUrl(runId, ref)} alt={ref} cmd={imgCmd} />}
        {type === "tab" && <TableView path={ref} />}
        {type === "fig" && (err ? <Empty><span className="text-alert">{err}</span></Empty>
          : spec && Renderer ? <Renderer spec={spec} s={settings} zkey={zkey} /> : <Empty>Loading…</Empty>)}
        {gear && spec && (
          <div className={clsx("pop absolute z-20 p-3", narrow ? "inset-x-2 bottom-2" : "right-2 top-2 w-60")}>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-2xs uppercase tracking-[0.12em] text-fg-faint">Settings</span>
              <button onClick={() => setGear(false)} aria-label="Close settings" className="text-fg-faint hover:text-fg"><X size={13} /></button>
            </div>
            <FigureSettings spec={spec} skey={skey} layout="col" />
          </div>
        )}
      </div>
      {(spec?.note || fig?.note || spec?.subsampled) && (
        <footer className="shrink-0 truncate border-t border-seam px-3 py-1 text-2xs text-fg-faint">
          {[fig?.note, spec?.note, spec?.subsampled ? `${spec.subsampled.toLocaleString()} points, showing 40,000` : null].filter(Boolean).join(" · ")}
        </footer>
      )}
    </section>
  );
}
