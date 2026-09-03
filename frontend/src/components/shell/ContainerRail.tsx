import { Activity, Waves, BarChart3, Grid3x3, Braces, Boxes, Brain } from "lucide-react";
import { clsx } from "clsx";
import { useStore } from "../../store/store";
import { GroupLabel } from "../ui/primitives";
import { PRESETS } from "../cards/registry";

const KIND_ICON: Record<string, typeof Waves> = {
  raw: Waves,
  epochs: Grid3x3,
  evoked: Activity,
  spectrum: BarChart3,
  tfr: BarChart3,
  ica: Braces,
  forward: Boxes,
  covariance: Boxes,
  inverse: Boxes,
  stc: Brain,
  dipole: Brain,
};

/** Ghost nodes: containers not created yet, shown so the path to them is visible. */
const GHOSTS = [
  { id: "epochs", kind: "epochs", label: "Epochs", hint: "needs events" },
  { id: "source", kind: "stc", label: "Source", hint: "needs forward + inverse" },
];

export function ContainerRail({
  presetIdx,
  onPreset,
}: {
  presetIdx: number;
  onPreset: (i: number) => void;
}) {
  const graph = useStore((s) => s.containerGraph);
  const active = useStore((s) => s.activeContainerId);
  const setActive = useStore((s) => s.setActiveContainer);
  const hasIca = useStore((s) => s.hasIca);

  const liveIds = new Set(graph.map((n) => n.id));
  const ghosts = GHOSTS.filter((g) => !liveIds.has(g.id) && !(g.id === "epochs" && liveIds.has("epochs")));
  const presets = PRESETS[active] ?? [];

  return (
    <div className="flex w-[136px] shrink-0 flex-col gap-1 border-r border-seam bg-bg p-1.5 max-[900px]:hidden">
      <GroupLabel>Containers</GroupLabel>
      {graph.map((n) => {
        const Icon = KIND_ICON[n.kind] ?? Waves;
        const nested = n.parent_id && n.parent_id !== "raw";
        return (
          <button
            key={n.id}
            onClick={() => setActive(n.id)}
            title={n.label}
            className={clsx(
              "flex items-center gap-2 rounded-xs border px-2 py-1 text-left text-xs transition-colors",
              nested && "ml-2",
              active === n.id
                ? "border-accent bg-accent/15 font-medium text-accent"
                : "border-seam text-fg-dim hover:border-seam-bright hover:text-fg",
            )}
          >
            <Icon size={12} className="shrink-0" />
            <span className="truncate">{n.label.split(" · ")[0]}</span>
          </button>
        );
      })}
      {!hasIca && (
        <button
          onClick={() => setActive("ica")}
          className="flex items-center gap-2 rounded-xs border border-dashed border-seam px-2 py-1 text-left text-xs text-fg-faint hover:text-fg-dim"
          title="Fit ICA to create this container"
        >
          <Braces size={12} className="shrink-0" /> <span className="truncate">ICA</span>
        </button>
      )}
      {ghosts.map((g) => {
        const Icon = KIND_ICON[g.kind] ?? Waves;
        return (
          <div
            key={g.id}
            title={g.hint}
            className="flex items-center gap-2 rounded-xs border border-dashed border-seam px-2 py-1 text-xs text-fg-faint"
          >
            <Icon size={12} className="shrink-0" /> <span className="truncate">{g.label}</span>
          </div>
        );
      })}

      {presets.length > 0 && (
        <>
          <GroupLabel>Layout</GroupLabel>
          {presets.map((p, i) => (
            <button
              key={p.name}
              onClick={() => onPreset(i)}
              className={clsx(
                "rounded-xs border px-2 py-1 text-left text-xs transition-colors",
                presetIdx === i
                  ? "border-fg-faint bg-panel-2 text-fg"
                  : "border-seam text-fg-dim hover:text-fg",
              )}
            >
              {p.name}
            </button>
          ))}
        </>
      )}
    </div>
  );
}
