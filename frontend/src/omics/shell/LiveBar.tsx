import { useEffect, useMemo, useRef, useState } from "react";
import { clsx } from "clsx";
import { ChevronDown, ChevronUp, Pin, Play, Tag, X } from "lucide-react";
import { api, type NounEntry, type Spec, type LiveResult } from "../api";
import { NO_EDITS, useStore } from "../store";
import { Btn } from "../ui/primitives";
import { RENDERERS } from "../figures/kinds";
import { defaults } from "../figures/settings";

/**
 * The controls that change the answer, on the surface of the figure. Each
 * section calls one of L1's live endpoints and renders the returned spec with
 * the standard renderer, so the live result is a figure, not a sentence.
 * Background jobs (refit DE) show a progress chip and survive navigation:
 * their state lives in the store keyed by run.
 */
export function LiveBar({ noun }: { noun: NounEntry }) {
  const wfId = useStore((s) => s.wfId);
  const runId = useStore((s) => s.runId);
  const engine = useStore((s) => s.run?.engine);
  const [open, setOpen] = useState(true);
  const sections: { title: string; el: React.ReactNode }[] = [];
  const kinds = new Set(noun.figures.map((f) => f.kind));

  if (runId && kinds.has("de") && engine === "python" && wfId === "bulk")
    sections.push({ title: "Thresholds · live counts", el: <Thresholds key="t" runId={runId} noun={noun.id} /> });
  if (runId && wfId === "bulk" && noun.id === "samples")
    sections.push({ title: "Samples · exclude and refit", el: <Samples key="s" runId={runId} /> });
  if (runId && wfId === "bulk" && (noun.id === "genes" || noun.id === "signatures" || noun.id === "pathways"))
    sections.push({ title: "Gene set · score · ORA", el: <GeneSets key="g" runId={runId} noun={noun.id} /> });
  if (runId && wfId === "snrna" && noun.id === "clusters")
    sections.push({ title: "Colour UMAP by gene", el: <UmapGene key="u" runId={runId} /> });

  if (!sections.length) return null;
  const chips = runId ? <JobChips runId={runId} /> : null;
  return (
    <section aria-label="Live controls" className={clsx("live-controls", open ? "max-h-[46%]" : "", "shrink-0 border-t border-seam bg-panel")}>
      <div className="flex h-7 items-center">
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open}
                className="flex h-7 items-center gap-2 px-3 text-2xs uppercase tracking-[0.12em] text-fg-faint hover:text-fg">
          {open ? <ChevronDown size={11} /> : <ChevronUp size={11} />} Live controls
        </button>
        {chips}
      </div>
      {open && (
        <div className="no-scrollbar flex flex-wrap items-start gap-3 overflow-auto border-t border-seam px-3 py-2 max-h-72">
          {sections.map((s) => (
            <div key={s.title} className="min-w-56 flex-1">
              <div className="mb-1 text-2xs uppercase tracking-[0.12em] text-fg-dim">{s.title}</div>
              {s.el}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** Floating chips for running background jobs (refit DE, GSEA). */
export function JobChips({ runId }: { runId: string }) {
  const jobs = useStore((s) => s.jobs);
  const mine = Object.entries(jobs).filter(([k]) => k.startsWith(`${runId}:`));
  if (!mine.length) return null;
  return (
    <span className="ml-auto flex gap-1 normal-case tracking-normal">
      {mine.map(([k, j]) => (
        <span key={k} title={j.error ?? j.label}
              className={clsx("mono flex items-center gap-1 rounded-xs border px-1.5 py-0.5 text-2xs",
                j.status === "done" ? "border-accent/60 text-accent" : j.status === "error" ? "border-alert/60 text-alert" : "border-seam text-fg-dim")}>
          {j.status === "done" ? "done" : j.status === "error" ? "failed" : <span className="dot dot-running" />} {j.label}
          {j.status === "done" && <button aria-label="Dismiss job" onClick={(e) => { e.stopPropagation(); useStore.getState().setJob(k, null); }}><X size={10} /></button>}
        </span>
      ))}
    </span>
  );
}

/** FDR / |log2FC| wired to /live/de_rethreshold: counts update as you type. */
function Thresholds({ runId, noun }: { runId: string; noun: string }) {
  const active = useStore((s) => s.active);
  const skey = active?.skey ?? "";
  const saved = useStore((s) => (skey ? s.settings[skey] : undefined)) ?? NO_EDITS;
  const d = active?.spec.defaults ?? {};
  const fdr = (saved.fdr as number) ?? d.fdr ?? 0.05;
  const lfc = (saved.lfc as number) ?? d.lfc ?? 0.3;
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const t = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (!active || active.spec.id !== "de") { setCounts(null); return; }
    clearTimeout(t.current);
    setBusy(true); setErr(null);
    t.current = setTimeout(() => {
      api.live(runId, "de_rethreshold", { fdr, lfc })
        .then((r: LiveResult) => setCounts(r.counts ?? null))
        .catch((e) => { setCounts(null); setErr(String(e.message ?? e)); })
        .finally(() => setBusy(false));
    }, 350);
    return () => clearTimeout(t.current);
  }, [runId, fdr, lfc, active?.spec.id]);
  if (!active || active.spec.id !== "de") return <p className="text-2xs text-fg-faint">Open the volcano to move its thresholds.</p>;
  const sig = counts?.["FDR_significant"];
  const up = counts?.["FDR_up_in_T"];
  const down = counts?.["FDR_down_in_T"];
  const expl = counts?.["exploratory_significant"];
  return (
    <div data-testid="live-thresholds" className="flex flex-wrap items-center gap-2">
      <Num label="FDR <" id="fdr" value={fdr} step={0.01} onChange={(v) => useStore.getState().setSetting(skey, "fdr", v)} />
      <Num label="|log2FC| ≥" id="lfc" value={lfc} step={0.05} onChange={(v) => useStore.getState().setSetting(skey, "lfc", v)} />
      <span className="mono text-2xs text-fg-dim" data-testid="threshold-counts">
        {busy ? "…" : err ? <span className="text-alert">{err}</span>
          : counts ? <span className="mono">FDR pass: <b className="text-fg">{sig}</b> ({up}↑ / {down}↓) · exploratory: <b className="text-fg">{expl}</b></span> : null}
      </span>
      {counts && <PinBtn name={`FDR${fdr}_LFC${lfc}`} fetch={() => sigGenes(runId, fdr, lfc)} noun={noun} />}
      <span className="w-full text-2xs text-fg-faint">live re-threshold, exact; the figure redraws from the same cut</span>
    </div>
  );
}

const sigGenes = async (runId: string, fdr: number, lfc: number) => {
  const r = await api.live(runId, "de_rethreshold", { fdr, lfc });
  return r.genes.filter((_: string, i: number) => (r.padj[i] ?? 1) < fdr && Math.abs(r.lfc[i] ?? 0) >= lfc);
};

function Num({ label, id, value, step, onChange }: { label: string; id: string; value: number; step: number; onChange: (v: number) => void }) {
  return <label className="mono flex items-center gap-1 text-2xs text-fg-dim">{label}
    <input type="number" value={value} step={step} min={0} aria-label={label} data-testid={`num-${id}`}
           onChange={(e) => onChange(Number(e.target.value))}
           className="h-7 w-20 rounded-sm border border-seam bg-bg px-1 text-2xs text-fg" />
  </label>;
}

/** Pin a gene list as a named set, shared across views and in the URL hash. */
function PinBtn({ name, fetch, noun }: { name: string; fetch: () => Promise<string[]>; noun: string }) {
  const { busy: pinBusy, act } = useAct();
  return <Btn busy={pinBusy === "pin"} onClick={() => act("pin", async () => {
    useStore.getState().pinSet(name, await fetch(), noun);
  })} title={`Pin this selection as "${name}" – highlighted in every view`}><Pin size={11} />Pin set</Btn>;
}

function useAct() {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const act = async (name: string, fn: () => Promise<void>) => {
    setBusy(name); setErr(null);
    try { await fn(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };
  return { busy, err, act };
}

const parseGenes = (text: string) => [...new Set(text.split(/[\s,;]+/).map((g) => g.trim().replace(/["']/g, "")).filter((g) => /^[A-Za-z][A-Za-z0-9._-]*$/.test(g)))];

/** Paste a gene list: mean-z/singscore, ORA, and pin as a named set. */
function GeneSets({ runId, noun }: { runId: string; noun: string }) {
  const [text, setText] = useState("");
  const [spec, setSpec] = useState<LiveResult | null>(null);
  const { busy, err, act } = useAct();
  const genes = useMemo(() => parseGenes(text), [text]);
  const op = (name: string, ep: string, body: Record<string, unknown>) => act(name, async () => setSpec(await api.live(runId, ep, body)));
  return (
    <div data-testid="gene-set-box" className="flex flex-col gap-2">
      <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)}
                placeholder="paste gene symbols, space or newline separated"
                aria-label="Gene list"
                className="mono h-14 w-full resize-none rounded-sm border border-seam bg-bg px-2 py-1 text-2xs text-fg placeholder:text-fg-faint" />
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mono text-2xs text-fg-faint">{genes.length} genes</span>
        <Btn disabled={!genes.length} busy={busy === "score"} onClick={() => op("score", "score_genes", { genes })}>Score</Btn>
        <Btn disabled={!genes.length} busy={busy === "ora"} onClick={() => op("ora", "ora", { genes })}>ORA</Btn>
        <Btn disabled={!genes.length} busy={busy === "pin"}
             onClick={() => act("pin", async () => useStore.getState().pinSet(`pasted ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`, genes, noun))}>
          <Pin size={11} />Pin
        </Btn>
      </div>
      {err && <p className="text-2xs text-alert">{err}</p>}
      {spec && <LiveSpec spec={spec} />}
      <PinnedSets />
    </div>
  );
}

function PinnedSets() {
  const sets = useStore((s) => s.geneSets);
  if (!sets.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1" data-testid="pinned-sets">
      {sets.map((s) => (
        <span key={s.name} className="mono flex items-center gap-1 rounded-xs border border-seam px-1.5 py-0.5 text-2xs text-fg-dim" title={`${s.genes.length} genes · ${s.origin}`}>
          <Tag size={10} className="text-accent" />{s.name} · {s.genes.length}
          <button aria-label={`Unpin ${s.name}`} onClick={() => useStore.getState().dropSet(s.name)} className="text-fg-faint hover:text-alert"><X size={10} /></button>
        </span>
      ))}
    </div>
  );
}

/** PCA: per-sample include/exclude, live exact recompute, refit DE as a job. */
function Samples({ runId }: { runId: string }) {
  const lkey = `${runId}:pca`;
  const spec = useStore((s) => s.live[lkey]);
  const setSpec = (v: LiveResult | null) => useStore.getState().setLive(lkey, v);
  const [exclude, setExclude] = useState<string[]>([]);
  // clearing the live badge on the figure restores every sample
  useEffect(() => { if (!spec) setExclude([]); }, [spec]);
  const [samples, setSamples] = useState<string[]>([]);
  const { busy, err, act } = useAct();
  const jobKey = `${runId}:de_refit`;
  const job = useStore((s) => s.jobs[jobKey]);
  // the samples of the full fit, straight from the figure spec
  useEffect(() => { api.figure(runId, "samples", "pca").then((s: Spec) => setSamples(s.names ?? [])).catch(() => {}); }, [runId]);
  const toggle = (s: string) => {
    const next = exclude.includes(s) ? exclude.filter((x) => x !== s) : [...exclude, s];
    setExclude(next);
    act("pca", async () => setSpec(await api.live(runId, "pca", { exclude: next, color: "group" })));
  };
  const refit = () => act("refit", async () => {
    const j = await api.live(runId, "de_refit", { exclude });
    const label = `refit DE − ${exclude.join(", ")}`;
    // an identical refit already ran: the result comes back inline, no job to poll
    if (j.job === "cached") {
      useStore.getState().setJob(jobKey, { id: "cached", label, status: "done", summary: j.spec?.summary ?? null, error: undefined });
      return;
    }
    useStore.getState().setJob(jobKey, { id: j.job, label, status: "queued", summary: null, error: undefined });
    pollJob(runId, j.job!, jobKey);
  });
  return (
    <div data-testid="sample-exclude" className="flex flex-col gap-2">
      <div className="no-scrollbar flex max-h-16 flex-wrap gap-1 overflow-auto">
        {samples.map((s: string) => {
          return (
            <button key={s} onClick={() => samples.length && toggle(s)} aria-pressed={exclude.includes(s)}
                    className={clsx("mono rounded-xs border px-1.5 py-0.5 text-2xs", exclude.includes(s) ? "border-alert/60 text-alert line-through" : "border-seam text-fg-dim hover:text-fg")}>
              {s}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Btn disabled={!exclude.length} busy={busy === "refit"} onClick={refit} title="Background job: refit DESeq2 without the excluded samples, then compare">
          <Play size={11} />Refit DE without these
        </Btn>
        {exclude.length > 0 && <Btn busy={busy === "pca"} onClick={() => { setExclude([]); act("pca", async () => setSpec(null)); }}>Reset</Btn>}
        {spec && <span className="mono text-2xs text-fg-faint">{spec.note}</span>}
      </div>
      {err && <p className="text-2xs text-alert">{err}</p>}
      {job?.summary && <p className="mono text-2xs text-fg-dim">refit vs full: r(log2FC) {job.summary.lfcCor} · {job.summary.nFull} full → {job.summary.nSens} significant at FDR 0.05</p>}
      {job?.error && <p className="text-2xs text-alert">{job.error}</p>}
    </div>
  );
}

/** Poll a live job into the store; 404 after a restart reads as unknown, not an error. */
const pollJob = (runId: string, jobId: string, key: string) => {
  const tick = async () => {
    try {
      const st = await api.job(runId, jobId);
      useStore.getState().setJob(key, { id: jobId, status: st.status, summary: st.spec?.summary ?? null, error: st.error });
      if (st.status === "queued" || st.status === "running") setTimeout(tick, 2500);
    } catch (e) {
      const msg = String((e as Error).message ?? e);
      useStore.getState().setJob(key, { status: msg.includes("404") ? "unknown" : "error", error: msg.includes("404") ? "job status unknown (server restarted)" : msg });
    }
  };
  setTimeout(tick, 1500);
};

/** snRNA: colour the UMAP by any gene, type-ahead over the tested genes. */
function UmapGene({ runId }: { runId: string }) {
  const [text, setText] = useState("");
  const setSpec = (v: LiveResult | null) => useStore.getState().setLive(`${runId}:umap`, v);
  const [all, setAll] = useState<string[]>([]);
  const { busy, err, act } = useAct();
  useEffect(() => {
    // gene list for type-ahead: the DE table's symbols, fetched once
    api.figure(runId, "de", "de").then((s: Spec) => setAll(s.genes ?? [])).catch(() => {});
  }, [runId]);
  const go = () => act("umap", async () => setSpec(await api.live(runId, "umap_gene", { gene: text.trim() })));
  const matches = text.trim().length > 0 ? all.filter((g) => g.toLowerCase().startsWith(text.trim().toLowerCase())).slice(0, 8) : [];
  return (
    <div data-testid="umap-gene" className="flex flex-col gap-2">
      <div className="relative flex items-center gap-1.5">
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()}
               placeholder="gene symbol…" aria-label="Colour UMAP by gene" list="umap-genes"
               className="mono h-7 w-40 rounded-sm border border-seam bg-bg px-1 text-2xs text-fg placeholder:text-fg-faint" />
        <datalist id="umap-genes">{all.slice(0, 500).map((g) => <option key={g} value={g} />)}</datalist>
        <Btn disabled={!text.trim()} busy={busy === "umap"} onClick={go}>Colour</Btn>
        {matches.length > 0 && (
          <span className="absolute left-40 top-7 z-10 flex flex-col rounded-sm border border-seam bg-bg">
            {matches.map((m) => <button key={m} className="mono px-2 py-0.5 text-left text-2xs text-fg-dim hover:bg-panel-2 hover:text-fg" onClick={() => { setText(m); setAll(all); }}>{m}</button>)}
          </span>
        )}
      </div>
      {err && <p className="text-2xs text-alert">{err}</p>}
    </div>
  );
}

/** Render any live spec with the standard renderer, in the dock. */
function LiveSpec({ spec }: { spec: LiveResult }) {
  const Renderer = RENDERERS[spec.kind];
  const s = useMemo(() => ({ ...defaults(spec) }), [spec]);
  const zkey = `live:${spec.id}:${spec.ms}`;
  if (!Renderer) return <p className="mono text-2xs text-fg-faint">{spec.note ?? spec.kind}</p>;
  return (
    <div className="relative h-44 min-w-0 overflow-hidden rounded-sm border border-seam" data-testid={`live-${spec.kind}`}>
      <Renderer spec={spec} s={s} zkey={zkey} />
      {spec.note && <footer className="absolute inset-x-0 bottom-0 truncate bg-bg/80 px-2 py-0.5 text-2xs text-fg-faint">{spec.note}{spec.exact ? "" : " (approximate)"}</footer>}
    </div>
  );
}
