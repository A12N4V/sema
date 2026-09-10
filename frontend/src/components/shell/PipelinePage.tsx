import { useState } from "react";
import { toast } from "sonner";
import { Download, GitBranch, Undo2, FileCode2, Table2, FileDown } from "lucide-react";
import { clsx } from "clsx";
import { api } from "../../api/client";
import { useStore } from "../../store/store";
import { useMediaQuery } from "../../lib/useMediaQuery";
import { Segmented } from "../ui/primitives";

/**
 * PIPELINE: the provenance DAG, full size. No signal display: this page is
 * about the process, not the data. Replaces the 29 px strip that used to sit
 * under every other view.
 *
 * ≥900px: DAG and detail/export side by side. Below that there is no room
 * for both: a segmented control swaps between them rather than hiding
 * export, which is the one thing this page exists to make reachable.
 */
export function PipelinePage() {
  const isDesktop = useMediaQuery("(min-width: 900px)");
  const [mobileView, setMobileView] = useState<"history" | "export">("history");
  const session = useStore((s) => s.session);
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

  const selected = history.find((h) => h.seq === selectedStep);
  const script = ["import mne", ...history.filter((h) => h.on_path).map((h) => h.rendered)].join("\n");

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      {!isDesktop && (
        <div className="flex shrink-0 justify-center border-b border-seam bg-bg p-1.5">
          <Segmented
            value={mobileView}
            onChange={setMobileView}
            options={[{ value: "history", label: "History" }, { value: "export", label: "Export" }]}
          />
        </div>
      )}
    <div className="flex min-h-0 flex-1 w-full">
      {/* the DAG */}
      <div className={clsx(
        "min-w-0 flex-1 flex-col overflow-y-auto bg-panel p-4",
        isDesktop || mobileView === "history" ? "flex" : "hidden",
      )}>
        <div className="mb-3 flex items-baseline gap-3">
          <h2 className="text-md font-medium">Pipeline</h2>
          <span className="mono text-2xs text-fg-faint">
            {history.length} step{history.length === 1 ? "" : "s"}
            {leaves.length > 1 && ` · ${leaves.length} branches`} · head #{head}
          </span>
        </div>

        <ol className="flex flex-col gap-1">
          <li>
            <StepRow
              label="pristine"
              sub="the recording as opened"
              active={head === 0}
              onClick={() => { setSelectedStep(null); void checkout(0); }}
              selected={selectedStep === null}
            />
          </li>
          {history.map((e) => {
            const forked = e.parent !== 0 && e.parent !== e.seq - 1;
            return (
              <li key={e.seq} className={clsx(forked && "ml-5")}>
                <StepRow
                  label={e.label}
                  sub={e.rendered}
                  seq={e.seq}
                  active={e.seq === head}
                  offPath={!e.on_path}
                  forked={forked}
                  selected={selectedStep === e.seq}
                  onClick={() => setSelectedStep(selectedStep === e.seq ? null : e.seq)}
                  onCheckout={() => void checkout(e.seq)}
                />
              </li>
            );
          })}
        </ol>

        {history.length === 0 && (
          <p className="mt-2 text-xs text-fg-faint">
            No operations yet. Everything you run is recorded here and replays into <span className="mono">pipeline.py</span>.
          </p>
        )}
      </div>

      {/* detail + export */}
      <div className={clsx(
        "w-full flex-col gap-4 overflow-y-auto border-seam bg-bg p-4 sm:w-[340px] sm:shrink-0 sm:border-l",
        isDesktop || mobileView === "export" ? "flex" : "hidden",
      )}>
        <section>
          <h3 className="mb-2 text-2xs uppercase tracking-wide text-fg-faint">
            {selected ? `Step #${selected.seq}` : "Step"}
          </h3>
          {selected ? (
            <div className="flex flex-col gap-2">
              <pre className="mono overflow-x-auto whitespace-pre-wrap rounded-xs border border-seam bg-panel p-2 text-2xs text-fg-dim">
                {selected.rendered}
              </pre>
              <KV k="op" v={selected.op} />
              {"n_bads" in selected.info_after && <KV k="bad after" v={String(selected.info_after.n_bads)} />}
              {"sfreq" in selected.info_after && <KV k="sfreq" v={`${String(selected.info_after.sfreq)} Hz`} />}
              <div className="flex gap-1.5 pt-1">
                <button
                  onClick={() => void checkout(selected.seq)}
                  className="flex items-center gap-1 rounded-xs border border-seam px-2 py-1 text-2xs text-fg-dim hover:text-fg"
                >
                  <Undo2 size={10} /> Check out
                </button>
                <button
                  onClick={() => void checkout(selected.seq)}
                  title="Check out here, then run an op to fork a branch"
                  className="flex items-center gap-1 rounded-xs border border-seam px-2 py-1 text-2xs text-fg-dim hover:text-fg"
                >
                  <GitBranch size={10} /> Branch
                </button>
              </div>
            </div>
          ) : (
            <p className="text-2xs text-fg-faint">Select a step to see its parameters.</p>
          )}
        </section>

        <section>
          <h3 className="mb-2 text-2xs uppercase tracking-wide text-fg-faint">Script</h3>
          {/* wrap, indented: a generated MNE call is often wider than this column,
              and a silently clipped line of code is worse than a wrapped one */}
          <pre className="mono max-h-48 overflow-auto whitespace-pre-wrap [text-indent:-2ch] pl-[2ch]
                          rounded-xs border border-seam bg-panel p-2 text-2xs leading-relaxed text-fg-dim">
            {script}
          </pre>
          <div className="mt-1.5 flex gap-1.5">
            <button
              onClick={() => { void navigator.clipboard.writeText(script); toast.success("Copied"); }}
              className="rounded-xs border border-seam px-2 py-1 text-2xs text-fg-dim hover:text-fg"
            >
              Copy
            </button>
            {id && <DlLink href={api.exportPipelineUrl(id)} icon={<FileCode2 size={10} />}>pipeline.py</DlLink>}
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-2xs uppercase tracking-wide text-fg-faint">Data</h3>
          <div className="flex flex-wrap gap-1.5">
            {id && <DlLink href={api.exportRawUrl(id)} icon={<FileDown size={10} />}>raw.fif</DlLink>}
            {id && <DlLink href={api.exportSummaryUrl(id)} icon={<Table2 size={10} />}>summary.csv</DlLink>}
          </div>
          <p className="mt-2 text-2xs text-fg-faint">
            <span className="mono">mne.Report</span> and BIDS derivatives are not built yet.
          </p>
        </section>
      </div>
    </div>
    </div>
  );
}

function StepRow({
  label, sub, seq, active, offPath, forked, selected, onClick, onCheckout,
}: {
  label: string; sub?: string; seq?: number; active?: boolean; offPath?: boolean;
  forked?: boolean; selected?: boolean; onClick: () => void; onCheckout?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={clsx(
        "group flex cursor-pointer items-center gap-2.5 rounded-sm border px-2.5 py-1.5 transition-colors",
        active ? "border-accent bg-accent/10" : "border-seam hover:border-seam-bright",
        selected && !active && "bg-panel-2",
        offPath && "border-dashed opacity-60",
      )}
    >
      <span
        className={clsx(
          "mono w-8 shrink-0 text-2xs",
          active ? "font-medium text-accent" : "text-fg-faint",
        )}
      >
        {seq == null ? "none" : `#${seq}`}
      </span>
      <div className="min-w-0 flex-1">
        <div className={clsx("truncate text-xs", active ? "font-medium text-accent" : "text-fg")}>
          {forked && <GitBranch size={9} className="mr-1 inline text-fg-faint" />}
          {label}
        </div>
        {sub && <div className="mono truncate text-2xs text-fg-faint">{sub}</div>}
      </div>
      {onCheckout && !active && (
        <button
          onClick={(e) => { e.stopPropagation(); onCheckout(); }}
          className="hidden shrink-0 rounded-xs border border-seam px-1.5 py-0.5 text-2xs text-fg-dim hover:text-fg group-hover:block"
        >
          check out
        </button>
      )}
    </div>
  );
}

const KV = ({ k, v }: { k: string; v: string }) => (
  <div className="flex items-baseline justify-between gap-2 text-xs">
    <span className="text-fg-faint">{k}</span>
    <span className="mono truncate text-fg-dim">{v}</span>
  </div>
);

const DlLink = ({ href, icon, children }: { href: string; icon: React.ReactNode; children: React.ReactNode }) => (
  <a
    href={href}
    target="_blank"
    rel="noreferrer"
    className="flex items-center gap-1 rounded-xs border border-seam px-2 py-1 text-2xs text-fg-dim hover:text-fg"
  >
    {icon ?? <Download size={10} />} {children}
  </a>
);
