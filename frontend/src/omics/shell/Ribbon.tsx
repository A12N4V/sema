import { useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import { BoxSelect, ChevronDown, ChevronUp, Download, FlaskConical, FolderOpen, FolderPlus, Minus, Play, Plus, RotateCcw, Square, Trash2, Upload, X } from "lucide-react";
import { Mark } from "../../components/ui/Brand";
import { navigate } from "../../lib/router";
import { useNarrow } from "../lib/useMedia";
import { GeneSearch } from "./GeneSearch";
import { api, fmtBytes, stageNum, type InputFile, type Value } from "../api";
import { NO_EDITS, useStore, useWorkflow } from "../store";
import { Btn, Group, IconBtn, Seg } from "../ui/primitives";
import { ParamRow } from "../panes/Params";
import { FigureSettings } from "../figures/FigureSettings";
import { downloadCanvas } from "../figures/FigureCard";

/**
 * The verb axis. Three tabs, each only what it says: Run (inputs, engine,
 * stages, the parameters people actually change), Figure (the settings of the
 * figure in front of you), Export (what leaves the workbench). The hot
 * parameters sit on the surface rather than behind the Parameters pane, Sema's
 * rule: the figure stays visible while you change the number that moves it.
 */
const HOT: Record<string, string[]> = {
  bulk: ["FDR", "LFC_MIN", "FIG_THEME"],
  snrna: ["BROAD_RESOLUTION", "FINE_RESOLUTION", "FIG_THEME"],
};
// Mirrors backend/app/demo.py: a synthetic notebook run in ~3 minutes.
const FAST_DEMO: Record<string, Value> = { RUN_PATHWAYS: false, RUN_TSNE: false, N_BOOTSTRAP: 500, N_TOP_HVG: 2000 };

export function Ribbon() {
  const ribbon = useStore((s) => s.ribbon);
  const tabs = [{ id: "run" as const, label: "Run" }, { id: "figure" as const, label: "Figure" }, { id: "export" as const, label: "Export" }];
  const pick = (t: (typeof tabs)[number]["id"]) =>
    useStore.getState().setRibbon(ribbon.tab === t && ribbon.open ? { open: false } : { tab: t, open: true });
  return (
    <div className="shrink-0 border-b border-seam bg-bg">
      {/* tab row, doubles as the title bar, as in Sema: one row of chrome */}
      <div className="flex h-8 items-stretch gap-0.5 px-1.5">
        <TitleMark />
        <div className="flex min-w-0 items-stretch gap-0.5" role="tablist" aria-label="Ribbon">
          {tabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={ribbon.open && ribbon.tab === t.id} onClick={() => pick(t.id)}
                    className={clsx("shrink-0 rounded-t-sm px-2.5 text-sm transition-colors",
                      ribbon.open && ribbon.tab === t.id ? "bg-panel font-medium text-fg" : "text-fg-faint hover:bg-panel-2/60 hover:text-fg-dim")}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <RunControls />
      </div>
      {ribbon.open && (
        <div className="no-scrollbar flex items-stretch overflow-x-auto bg-panel py-1.5" role="tabpanel">
          {ribbon.tab === "run" && <RunTab />}
          {ribbon.tab === "figure" && <FigureTab />}
          {ribbon.tab === "export" && <ExportTab />}
        </div>
      )}
    </div>
  );
}

/** Sema's mark and the workbench's name: the data chose it, so it is a label, not a tab. */
function TitleMark() {
  const wf = useWorkflow();
  const narrow = useNarrow();
  return (
    <span className="flex shrink-0 items-center gap-2 pr-2" title={wf ? `${wf.title}\n${wf.gloss}` : "Sema"}>
      <Mark size={16} />
      {wf && <span className="text-sm font-medium text-fg">{wf.name}</span>}
      {wf && !narrow && <span className="truncate text-2xs text-fg-faint">{wf.title}</span>}
    </span>
  );
}

/** What the old top bar carried that still earns its place: the gene, the run, a way out. */
function RunControls() {
  const wfId = useStore((s) => s.wfId);
  const allRuns = useStore((s) => s.runs);
  const runs = allRuns.filter((r) => r.workflow === wfId);
  const runId = useStore((s) => s.runId);
  const gene = useStore((s) => s.gene);
  const ribbon = useStore((s) => s.ribbon);
  const caps = useStore((s) => s.caps);
  const engine = useStore((s) => s.engine[s.wfId]);
  const wf = useWorkflow();
  const narrow = useNarrow();
  const eng = engine ?? wf?.engines[0];
  const engineOk = eng === "R" ? !!caps?.rscript : !!caps?.python.scanpy;
  return (
    <>
      {gene && (
        <span className="my-1.5 flex min-w-0 shrink items-center gap-1 rounded-sm border border-accent/50 bg-accent/10 pl-2 pr-1 text-2xs text-accent" title="Selected gene: highlighted in every figure">
          <span className="mono truncate italic">{gene}</span>
          <button onClick={() => useStore.getState().set({ gene: null })} aria-label="Clear selected gene" className="text-accent/70 hover:text-accent"><X size={11} /></button>
        </span>
      )}
      <GeneSearch />
      {!narrow && (
        <span className={clsx("mono my-1.5 flex shrink-0 items-center gap-1.5 rounded-sm border px-2 text-2xs",
          engineOk ? "border-seam text-fg-faint" : "border-alert/50 text-alert")}
          title={eng === "R" ? (caps?.rscript ?? "Rscript not found") : eng === "python" ? "Python port (pydeseq2)" : "scanpy kernel"}>
          <span className={clsx("dot", engineOk ? "dot-done" : "dot-failed")} />
          {eng === "R" ? (caps?.rscript ? "Rscript" : "no R") : eng === "python" ? `pydeseq2 ${caps?.python.pydeseq2 ?? ""}` : `scanpy ${caps?.python.scanpy ?? ""}`}
        </span>
      )}
      <select value={runId ?? ""} onChange={(e) => useStore.getState().set({ runId: e.target.value })} aria-label="Run"
              className="mono my-1.5 ml-1 w-0 min-w-20 max-w-52 shrink rounded-sm border border-seam bg-bg px-1 text-2xs text-fg-dim sm:w-auto">
        {!runs.length && <option value="">no runs</option>}
        {runs.map((r) => <option key={r.id} value={r.id}>{r.id.slice(4, 15)} · {r.engine} · {r.status}</option>)}
      </select>
      <button onClick={() => navigate("/connect")} title="Open another dataset" aria-label="Open another dataset"
              className="flex shrink-0 items-center px-2 text-fg-faint transition-colors hover:text-fg">
        <FolderOpen size={14} />
      </button>
      <button onClick={() => useStore.getState().setRibbon({ open: !ribbon.open })}
              aria-label={ribbon.open ? "Collapse ribbon" : "Expand ribbon"}
              className="flex shrink-0 items-center px-1 text-fg-faint transition-colors hover:text-fg">
        {ribbon.open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>
    </>
  );
}

function useAct() {
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (name: string, fn: () => Promise<void>) => {
    setBusy(name); useStore.getState().set({ error: null });
    try { await fn(); } catch (e) { useStore.getState().set({ error: e instanceof Error ? e.message : String(e) }); } finally { setBusy(null); }
  };
  return { busy, act };
}

function RunTab() {
  const wf = useWorkflow()!;
  const run = useStore((s) => s.run);
  const caps = useStore((s) => s.caps);
  const edits = useStore((s) => s.edits[s.wfId]) ?? NO_EDITS;
  const engine = useStore((s) => s.engine[s.wfId] ?? wf.engines[0]);
  const [inputs, setInputs] = useState<{ uploaded: InputFile[]; demo: InputFile[] }>({ uploaded: [], demo: [] });
  const [source, setSource] = useState<"demo" | "uploaded">("demo");
  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const { busy, act } = useAct();
  const fileRef = useRef<HTMLInputElement>(null);
  const role = useRef<string | undefined>(undefined);

  useEffect(() => {
    api.inputs(wf.id).then((i) => { setInputs(i); setSource(i.uploaded.length && !i.demo.length ? "uploaded" : "demo"); });
    setFrom(wf.stages[0].id); setTo(wf.stages[wf.stages.length - 1].id);
  }, [wf]);

  const files = inputs[source];
  const isActive = !!run?.active;
  const engineOk = engine === "R" ? !!caps?.rscript : true;
  const sameRun = run && run.workflow === wf.id && run.source === source && run.engine === engine;
  const nEdits = Object.keys(edits).length;
  const start = (fresh: boolean) => act("run", async () => {
    const target = !fresh && sameRun ? run : await api.newRun(wf.id, source, engine);
    const m = await api.execute(target.id, edits, from, to);
    useStore.getState().set({ runId: m.id, run: m });
    useStore.getState().setPage("pipeline");
    useStore.getState().set({ runs: await api.runs() });
  });
  const pick = (r?: string) => { role.current = r; fileRef.current?.click(); };

  return (
    <>
      <Group label="Inputs">
        <Seg label="Input source" value={source} onChange={setSource}
             options={[{ value: "demo", label: "Synthetic" }, { value: "uploaded", label: "Your data" }]} />
        {source === "demo" ? (
          <Btn busy={busy === "demo"} title="Generate inputs that exercise every stage. Not biology."
               onClick={() => act("demo", async () => setInputs({ ...inputs, ...(await api.makeDemo(wf.id)) }))}>
            <FlaskConical size={12} />{inputs.demo.length ? "Regenerate" : "Generate"}
          </Btn>
        ) : wf.id === "bulk" ? (
          <>
            <Btn onClick={() => pick("counts")} busy={busy === "up-counts"}><Upload size={12} />Counts</Btn>
            <Btn onClick={() => pick("metadata")} busy={busy === "up-metadata"}><Upload size={12} />Metadata</Btn>
            <Btn onClick={() => pick("signatures")} busy={busy === "up-signatures"} title="DG_cell_type_signatures.csv, targeted_axes_signatures.csv"><Upload size={12} />Signatures</Btn>
          </>
        ) : (
          <Btn onClick={() => pick(undefined)} busy={busy === "up-undefined"}><Upload size={12} />CellBender .h5</Btn>
        )}
        <input ref={fileRef} type="file" hidden multiple={wf.id === "snrna" || role.current === "signatures"}
               accept={wf.id === "snrna" ? ".h5" : undefined}
               onChange={(e) => {
                 const fl = e.target.files; if (!fl?.length) return;
                 act(`up-${role.current}`, async () => setInputs({ ...inputs, ...(await api.upload(wf.id, fl, role.current)) }));
                 e.target.value = "";
               }} />
        <span className="mono w-24 text-2xs leading-tight text-fg-faint" title={files.map((f) => f.name).join("\n")}>
          {files.length ? <>{files.length} files<br />{fmtBytes(files.reduce((a, f) => a + f.bytes, 0))}</> : "none yet"}
        </span>
      </Group>

      {wf.engines.length > 1 && (
        <Group label="Engine">
          <Seg label="Engine" value={engine} onChange={(e) => useStore.getState().setEngine(e)}
               options={wf.engines.map((e) => ({ value: e, label: e === "python" ? "Python" : e }))} />
        </Group>
      )}

      <Group label="Stages">
        <StageSelect value={from} onChange={setFrom} label="From" />
        <span className="text-fg-faint">→</span>
        <StageSelect value={to} onChange={setTo} label="To" />
        {isActive ? (
          <Btn tone="alert" busy={busy === "cancel"} onClick={() => run && act("cancel", async () => { await api.cancel(run.id); })}><Square size={11} />Stop</Btn>
        ) : (
          <>
            <Btn tone="accent" disabled={!files.length || !engineOk} busy={busy === "run"} onClick={() => start(false)}
                 title={!engineOk ? "Rscript not found: brew install r, or use the Python engine" : sameRun ? `Run again in ${run!.id}; earlier outputs kept` : "Start a new run"}>
              <Play size={11} />{sameRun ? "Run" : "Start"}
            </Btn>
            {sameRun && <Btn onClick={() => start(true)} disabled={!files.length || !engineOk} title="Start in a fresh run folder" aria-label="New run folder"><FolderPlus size={12} /></Btn>}
          </>
        )}
      </Group>

      <Group label={`Parameters · ${nEdits} edited`}>
        <div className="flex items-center gap-3">
          {HOT[wf.id].map((n) => { const p = wf.params.find((q) => q.name === n); return p ? <div key={n} className="w-44"><ParamRow p={p} value={edits[n]} compact /></div> : null; })}
        </div>
        <Btn onClick={() => useStore.getState().resetParams()} disabled={!nEdits} title="Back to the values in the code"><RotateCcw size={12} />Defaults</Btn>
        {wf.id === "snrna" && <Btn onClick={() => useStore.getState().applyParams(FAST_DEMO)} title={Object.entries(FAST_DEMO).map(([k, v]) => `${k} = ${v}`).join("\n")}><FlaskConical size={12} />Fast demo</Btn>}
      </Group>

      {engine === "R" && !caps?.rscript && (
        <Group label="R not installed">
          <code className="mono rounded-xs border border-warn/40 px-1.5 py-0.5 text-2xs text-warn" title="then: Rscript workflows/bulk-r/00_install_packages.R">brew install r</code>
        </Group>
      )}
    </>
  );
}

function StageSelect({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const wf = useWorkflow()!;
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}
            className="mono h-6 max-w-36 rounded-sm border border-seam bg-bg px-1 text-2xs text-fg-dim">
      {wf.stages.map((s) => <option key={s.id} value={s.id}>{stageNum(s.id)} {s.title}</option>)}
    </select>
  );
}

function FigureTab() {
  const active = useStore((s) => s.active);
  if (!active) return <p className="px-3 py-2 text-xs text-fg-faint">Open a figure from the strip below; its settings appear here.</p>;
  const z = (op: "in" | "out" | "reset" | "box") => useStore.getState().zoom(active.zkey, op);
  return (
    <>
      <Group label={active.spec.title}>
        <FigureSettings spec={active.spec} skey={active.skey} />
      </Group>
      <Group label="View">
        <IconBtn label="Box zoom" onClick={() => z("box")}><BoxSelect size={13} /></IconBtn>
        <IconBtn label="Zoom out" onClick={() => z("out")}><Minus size={13} /></IconBtn>
        <IconBtn label="Zoom in" onClick={() => z("in")}><Plus size={13} /></IconBtn>
        <IconBtn label="Reset view" onClick={() => z("reset")}><RotateCcw size={12} /></IconBtn>
      </Group>
      {/* Defaults group cut (U1.b bloat): the gear popover's settings already reset by
          clearing the same localStorage key, and nobody reset defaults twice a day. */}
    </>
  );
}

function ExportTab() {
  const run = useStore((s) => s.run);
  const active = useStore((s) => s.active);
  const { act } = useAct();
  const has = !!run?.ledger.length;
  return (
    <>
      <Group label="This run">
        <a href={has ? api.exportUrl(run!.id) : undefined} aria-disabled={!has}
           className={clsx("flex h-6 items-center gap-1.5 rounded-sm border border-seam px-2 text-xs text-fg-dim", has ? "hover:border-seam-bright hover:text-fg" : "pointer-events-none opacity-40")}
           title="The code with this run's configuration, the ledger, and run.sh">
          <Download size={12} />{run?.engine === "notebook" ? "Notebook + run.sh" : run?.engine === "R" ? "R scripts + config.R" : "Python scripts + config.py"}
        </a>
        {/* "Every execution" button cut (U1.c): duplicate of the Ledger chip in the
            strip, one keystroke away via ⌘K as well. */}
      </Group>
      <Group label="Figure in view">
        <Btn disabled={!active} onClick={() => downloadCanvas(document.querySelector("main section"), active?.spec.id ?? "figure")}><Download size={12} />PNG</Btn>
      </Group>
      {run && !run.active && (
        <Group label="Run folder">
          <Btn onClick={() => act("del", async () => { await api.remove(run.id); useStore.getState().set({ runId: null, run: null, runs: await api.runs() }); })}>
            <Trash2 size={12} />Delete
          </Btn>
        </Group>
      )}
    </>
  );
}
