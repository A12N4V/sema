import { Activity, Boxes, Brain, GitBranch, Grid3x3, Layers, Lock, Table2, Waves } from "lucide-react";
import { clsx } from "clsx";
import { useStore } from "../../store/store";
import { navigate, sessionPath, type Page } from "../../lib/router";

/**
 * The noun axis: one chip per MNE container in this session, along the bottom
 * like a spreadsheet's sheet tabs. Together with the ribbon (the verb axis)
 * this is the whole navigation model: *what am I looking at* down here, *what
 * do I do to it* up there.
 *
 * Chips are generated from the server's `container_graph()`, so a container
 * that exists is always reachable in one click and one never has to be added
 * here by hand. The containers MNE offers but this build hasn't grown yet
 * appear as locked ghosts rather than being hidden, a professional should be
 * able to see the shape of the whole tool, including its edges.
 *
 * The precompute pass paints the strip's top edge as it fills, so "the figures
 * are being prepared" is ambient rather than a modal or a spinner in a pane.
 */
interface ChipDef {
  page: Page;
  label: string;
  icon: typeof Waves;
  /** container id in the graph: present means "live" */
  container?: string;
  /** shown when the container doesn't exist yet */
  hint: string;
}

const LIVE: ChipDef[] = [
  { page: "signal", label: "Raw", icon: Waves, container: "raw", hint: "the continuous recording" },
  { page: "channels", label: "Channels", icon: Table2, hint: "channels and annotations" },
  { page: "ica", label: "ICA", icon: Layers, container: "ica", hint: "fit ICA to decompose the recording" },
  { page: "epochs", label: "Epochs", icon: Grid3x3, container: "epochs", hint: "cut trials around events" },
  { page: "evoked", label: "Evoked", icon: Activity, container: "evoked", hint: "average the epochs" },
  { page: "tfr", label: "TFR", icon: Boxes, container: "tfr", hint: "power over time and frequency" },
  { page: "source", label: "Source", icon: Brain, container: "source", hint: "compute a source estimate" },
];

/**
 * Containers MNE has and this build still does not. Kept visible rather than
 * hidden: a professional should be able to see the edges of the tool.
 * See docs/MNE_CAPABILITY_MAP.md.
 */
const GHOSTS: { label: string; icon: typeof Waves; needs: string }[] = [
  { label: "Connectivity", icon: Boxes, needs: "not built yet: needs mne-connectivity" },
];

export function ContainerStrip({ page }: { page: Page }) {
  const session = useStore((s) => s.session);
  const graph = useStore((s) => s.containerGraph);
  const history = useStore((s) => s.history);
  const leaves = useStore((s) => s.leaves);
  const prepState = useStore((s) => s.prepState);
  const prepProgress = useStore((s) => s.prepProgress);
  const prepDetail = useStore((s) => s.prepDetail);
  if (!session) return null;

  const live = new Set(graph.map((n) => n.id));
  const labelFor = (id?: string) => graph.find((n) => n.id === id)?.label;
  const go = (p: Page) => navigate(sessionPath(session.session_id, p));

  return (
    <div className="relative flex h-8 shrink-0 items-stretch gap-0.5 overflow-x-auto border-t border-seam bg-bg px-1.5">
      {/* the precompute pass, as a hairline along the seam */}
      {prepState === "running" && (
        <div
          className="absolute -top-px left-0 h-px bg-accent transition-[width] duration-300"
          style={{ width: `${Math.round(prepProgress * 100)}%` }}
          role="progressbar"
          aria-valuenow={Math.round(prepProgress * 100)}
          aria-label="Preparing figures"
        />
      )}

      {LIVE.map((c) => {
        const exists = !c.container || live.has(c.container);
        const Icon = c.icon;
        return (
          <button
            key={c.page}
            onClick={() => go(c.page)}
            aria-current={page === c.page ? "page" : undefined}
            title={exists ? labelFor(c.container) ?? c.hint : `${c.label}: ${c.hint}`}
            className={clsx(
              "flex shrink-0 items-center gap-1.5 rounded-t-sm px-2.5 text-xs transition-colors",
              page === c.page
                ? "bg-panel font-medium text-fg shadow-[inset_0_1px_0_var(--color-accent)]"
                : exists
                  ? "text-fg-dim hover:bg-panel-2/60 hover:text-fg"
                  : "text-fg-faint hover:text-fg-dim",
            )}
          >
            <Icon size={11} className="shrink-0" />
            {/* full words, always. An abbreviated chip ("Epo", "Evo") is not a
                word and not a saving: the strip already scrolls when it must. */}
            {c.label}
            {!exists && <Lock size={9} className="shrink-0 opacity-60" />}
          </button>
        );
      })}

      {/* the not-yet-built containers are context, not navigation, the first
          thing to drop when the strip runs out of room */}
      <div className="my-1.5 w-px shrink-0 bg-seam max-[720px]:hidden" />

      {GHOSTS.map((g) => {
        const Icon = g.icon;
        return (
          <span
            key={g.label}
            title={g.needs}
            className="flex cursor-default items-center gap-1.5 rounded-t-sm px-2 text-xs text-fg-faint opacity-45 max-[720px]:hidden"
          >
            <Icon size={11} className="shrink-0" />
            <span>{g.label}</span>
          </span>
        );
      })}

      <div className="flex-1" />

      {/* provenance is not a container, it sits apart, on the right */}
      <button
        onClick={() => go("pipeline")}
        aria-current={page === "pipeline" ? "page" : undefined}
        title="Provenance, branches and export"
        className={clsx(
          "flex shrink-0 items-center gap-1.5 rounded-t-sm px-2.5 text-xs transition-colors",
          page === "pipeline"
            ? "bg-panel font-medium text-fg shadow-[inset_0_1px_0_var(--color-accent)]"
            : "text-fg-dim hover:bg-panel-2/60 hover:text-fg",
        )}
      >
        {leaves.length > 1 ? <GitBranch size={11} /> : <GitBranch size={11} className="opacity-50" />}
        Pipeline
        <span className="mono text-2xs text-fg-faint">{history.length}</span>
      </button>

      <span
        title={prepDetail}
        className={clsx(
          "mono flex shrink-0 items-center px-2 text-2xs max-[720px]:hidden",
          prepState === "error" ? "text-alert" : "text-fg-faint",
        )}
      >
        {prepState === "running"
          ? `preparing ${Math.round(prepProgress * 100)}%`
          : prepState === "ready"
            ? "figures ready"
            : prepState === "blocked"
              ? "figures need a montage"
              : prepState === "error"
                ? "figures failed"
                : ""}
      </span>
    </div>
  );
}
