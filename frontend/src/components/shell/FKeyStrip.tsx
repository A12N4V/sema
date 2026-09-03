import { useStore } from "../../store/store";
import { PANELS } from "./panelRegistry";

const PRESET_LABEL: Record<string, string> = { terminal: "Workspace", clean: "Focus", report: "Report" };

export function FKeyStrip() {
  const focused = useStore((s) => s.focusedPanel);
  const focusPanel = useStore((s) => s.focusPanel);
  const preset = useStore((s) => s.preset);
  const setPreset = useStore((s) => s.setPreset);

  return (
    <div className="flex h-8 shrink-0 items-center border-t border-seam bg-bg text-sm">
      {PANELS.map((p) => (
        <button
          key={p.id}
          onClick={() => focusPanel(focused === p.id ? null : p.id)}
          title={`${p.title} (${p.fkey})`}
          className={`relative h-full px-3 transition-colors ${
            focused === p.id
              ? "text-accent after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-accent"
              : "text-fg-dim hover:bg-panel-2 hover:text-fg"
          }`}
        >
          {p.title}
        </button>
      ))}
      <div className="flex-1" />
      <div className="flex gap-0.5 pr-1.5">
        {(["terminal", "clean", "report"] as const).map((p) => (
          <button
            key={p}
            onClick={() => setPreset(p)}
            className={`rounded-xs px-2.5 py-1 transition-colors ${
              preset === p ? "bg-panel-2 text-fg" : "text-fg-faint hover:text-fg-dim"
            }`}
          >
            {PRESET_LABEL[p]}
          </button>
        ))}
      </div>
    </div>
  );
}
