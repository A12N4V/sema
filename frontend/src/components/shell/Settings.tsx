import { useEffect } from "react";
import { X, Monitor, Sun, Moon } from "lucide-react";
import { useStore } from "../../store/store";
import type { Theme } from "../../lib/theme";

const THEME_OPTS: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

/** Kept in step with the handler in App.tsx by hand: if you add one there, add
 *  it here. A shortcut card that lists a key which does nothing is worse than
 *  no card, and this one advertised F1-F7 for a solo mode that no longer
 *  exists. */
const SHORTCUTS: [string, string][] = [
  ["⌘K / Ctrl+K", "Command palette"],
  ["⌘1 / ⌘2 / ⌘3", "Signal · Channels · ICA"],
  ["Space", "Play / pause"],
  ["← / →", "Page the window"],
  ["Shift + ← / →", "Nudge cursor 1 s"],
  ["[  /  ]", "Shrink / grow window"],
  ["Esc", "Exit a maximized pane"],
];

export function Settings() {
  const open = useStore((s) => s.settingsOpen);
  const setOpen = useStore((s) => s.setSettingsOpen);
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);

  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [open, setOpen]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 pt-[14vh] backdrop-blur-[1px] max-[480px]:pt-6"
      onMouseDown={() => setOpen(false)}
    >
      <div className="pop w-[420px] max-w-[92vw] overflow-hidden" onMouseDown={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-seam px-4 py-2.5">
          <span className="text-md font-semibold text-fg">Settings</span>
          <button onClick={() => setOpen(false)} className="rounded-xs p-0.5 text-fg-faint hover:bg-panel-2 hover:text-fg">
            <X size={15} />
          </button>
        </header>

        <div className="flex flex-col gap-5 p-4">
          <section>
            <div className="mb-2 text-sm font-medium text-fg">Appearance</div>
            <div className="flex gap-1 rounded-sm border border-seam bg-panel-2 p-1">
              {THEME_OPTS.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  onClick={() => setTheme(value)}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-xs px-2 py-1.5 text-sm transition-colors ${
                    theme === value ? "bg-panel text-fg shadow-sm" : "text-fg-dim hover:text-fg"
                  }`}
                >
                  <Icon size={14} />
                  {label}
                </button>
              ))}
            </div>
          </section>

          <section>
            <div className="mb-2 text-sm font-medium text-fg">Keyboard</div>
            <dl className="flex flex-col gap-1">
              {SHORTCUTS.map(([keys, desc]) => (
                <div key={keys} className="flex items-baseline justify-between text-sm">
                  <dt className="text-fg-dim">{desc}</dt>
                  <dd className="mono text-xs text-fg-faint">{keys}</dd>
                </div>
              ))}
            </dl>
          </section>

          <p className="border-t border-seam pt-3 text-xs text-fg-faint">
            Sessions are held in memory and expire after 2 h idle.
          </p>
        </div>
      </div>
    </div>
  );
}
