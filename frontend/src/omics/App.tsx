import { useEffect } from "react";
import { Loader2, X } from "lucide-react";
import { api } from "./api";
import { usePage, useStore, useWorkflow } from "./store";
import { Ribbon } from "./shell/Ribbon";
import { NounStrip } from "./shell/NounStrip";
import { PipelinePage } from "./pages/PipelinePage";
import { NounPage } from "./pages/NounPage";
import { LedgerPage } from "./pages/LedgerPage";
import { Empty } from "./ui/primitives";
import { Palette, useShortcuts } from "./shell/Palette";
import { readHash } from "./shell/hash";
import { navigate, omicsPath, type OmicsWorkflow } from "../lib/router";

/**
 * Sema's shell, for a method instead of a recording. The workflow is not a
 * toggle: the data decides it (the launcher detects the format and routes to
 * /p or /k), so the ribbon's tab row carries the title and the run instead.
 *
 *   ribbon         verbs: run it, tune the figure, take it with you
 *   viewport       the page: the pipeline, one kind of result, or the ledger
 *   strip          nouns: the kinds of result this run has produced
 *
 * Exactly one viewport tall at every width; panes scroll inside themselves.
 */
export function OmicsApp({ workflow, routeRun }: { workflow: OmicsWorkflow; routeRun: string | null }) {
  const wf = useWorkflow();
  const wfId = useStore((s) => s.wfId);
  const runs = useStore((s) => s.runs);
  const runId = useStore((s) => s.runId);
  const run = useStore((s) => s.run);
  const catalogue = useStore((s) => s.catalogue);
  const error = useStore((s) => s.error);
  const page = usePage();
  const set = useStore((s) => s.set);
  useShortcuts();

  // the route owns the workflow and the run; the store follows it
  useEffect(() => {
    if (useStore.getState().wfId !== workflow) useStore.getState().setWf(workflow);
  }, [workflow]);
  useEffect(() => {
    if (routeRun && routeRun !== useStore.getState().runId) set({ runId: routeRun });
  }, [routeRun, set]);
  useEffect(() => {
    if (wfId === workflow && runId && runId !== routeRun) navigate(omicsPath(workflow, runId), true);
  }, [wfId, workflow, runId, routeRun]);

  useEffect(() => {
    readHash();
    api.workflows().then((w) => set({ workflows: w })).catch((e) => set({ error: `Cannot reach the backend: ${e.message}` }));
    api.caps().then((c) => set({ caps: c })).catch(() => {});
    api.runs().then((r) => set({ runs: r })).catch(() => {});
  }, [set]);

  // newest run of this workflow when nothing valid is selected
  useEffect(() => {
    if (wfId !== workflow || !runs.length) return;
    const mine = runs.filter((r) => r.workflow === wfId);
    if (!runId || !mine.some((r) => r.id === runId)) set({ runId: mine[0]?.id ?? null });
  }, [wfId, workflow, runs, runId, set]);

  // follow the run while it executes
  useEffect(() => {
    if (!runId) { set({ run: null, catalogue: [] }); return; }
    let live = true, t: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const m = await api.run(runId);
        if (!live) return;
        set({ run: m });
        if (m.active) t = setTimeout(tick, 1200);
        else api.runs().then((r) => live && set({ runs: r }));
      } catch { /* deleted */ }
    };
    tick();
    return () => { live = false; clearTimeout(t); };
  }, [runId, run?.ledger.length, set]);

  // the noun strip follows what the run has written
  const stagesKey = run ? JSON.stringify(run.stages) : "";
  useEffect(() => {
    if (!runId) return;
    api.catalogue(runId).then((c) => set({ catalogue: c })).catch(() => set({ catalogue: [] }));
  }, [runId, stagesKey, set]);

  if (!wf || wfId !== workflow) {
    return <div className="flex h-full items-center justify-center text-fg-faint">{error ? <span className="text-alert">{error}</span> : <Loader2 className="animate-spin" size={16} />}</div>;
  }
  const noun = catalogue.find((n) => n.id === page);
  return (
    <div className="flex h-full w-full flex-col bg-bg">
      <Ribbon />
      {error && (
        <div className="flex shrink-0 items-center gap-2 border-b border-seam bg-alert/10 px-3 py-1 text-sm text-alert" role="alert">
          <span className="min-w-0 flex-1 truncate">{error}</span>
          <button onClick={() => set({ error: null })} aria-label="Dismiss"><X size={13} /></button>
        </div>
      )}
      <main className="min-h-0 flex-1">
        {page === "pipeline" ? <PipelinePage />
          : page === "ledger" ? <LedgerPage />
            : noun ? <NounPage noun={noun} />
              : <Empty>{runId ? "Nothing here yet." : "Generate synthetic inputs or add your own in the ribbon, then Start."}</Empty>}
      </main>
      <NounStrip />
      <Palette />
    </div>
  );
}
