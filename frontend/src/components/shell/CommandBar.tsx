import { useEffect, useRef, useState } from "react";
import { Plus, LayoutGrid, Settings2, FolderOpen } from "lucide-react";
import { clsx } from "clsx";
import { useStore } from "../../store/store";
import { Chip } from "../ui/primitives";
import { cardsFor } from "../cards/registry";

const CAP_LABEL: Record<string, string> = {
  montage: "montage",
  filtered_1hz: "≥1 Hz",
  has_bads: "bads",
  ica: "ICA",
  epochs: "epochs",
};

function AddCardMenu({ onAdd, present }: { onAdd: (id: string) => void; present: string[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = useStore((s) => s.activeContainerId);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, [open]);
  const options = cardsFor(active).filter((c) => !present.includes(c.id));
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex h-full items-center gap-1.5 px-2.5 text-sm text-fg-dim transition-colors hover:bg-panel-2 hover:text-fg"
        title="Add a view card"
      >
        <LayoutGrid size={13} /> Cards
      </button>
      {open && (
        <div className="pop absolute left-1 top-[calc(100%+4px)] z-40 w-44 p-1">
          {options.length === 0 && <div className="px-2 py-1.5 text-xs text-fg-faint">All cards shown.</div>}
          {options.map((c) => (
            <button
              key={c.id}
              onClick={() => { onAdd(c.id); setOpen(false); }}
              className="block w-full rounded-xs px-2 py-1.5 text-left text-sm text-fg-dim hover:bg-panel-2 hover:text-fg"
            >
              {c.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function CommandBar({
  cards,
  onAddCard,
  onNewSession,
}: {
  cards: string[];
  onAddCard: (id: string) => void;
  onNewSession: () => void;
}) {
  const session = useStore((s) => s.session);
  const setPaletteOpen = useStore((s) => s.setPaletteOpen);
  const openSettings = useStore((s) => s.setSettingsOpen);
  const caps = useStore((s) => s.capabilities);
  const active = useStore((s) => s.activeContainerId);
  if (!session) return null;

  return (
    <div className="flex h-9 shrink-0 items-stretch border-b border-seam bg-bg">
      <button
        onClick={() => setPaletteOpen(true)}
        className="flex h-full items-center gap-1.5 border-r border-seam px-3 text-sm font-medium text-fg-dim transition-colors hover:bg-panel-2 hover:text-fg"
        title="Run an MNE operation  (⌘K)"
      >
        <Plus size={13} /> Operation
        <span className="mono ml-1 text-2xs text-fg-faint">⌘K</span>
      </button>

      <AddCardMenu onAdd={onAddCard} present={cards} />

      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden px-3">
        <span className="mono shrink-0 truncate text-xs text-fg-dim">{session.filename}</span>
        <span className="mx-1 h-3.5 w-px shrink-0 bg-seam" />
        <Chip tone="accent">{active}</Chip>
        <Chip title="channels">{session.n_channels} ch</Chip>
        <Chip title="sample rate">{session.sfreq.toFixed(0)} Hz</Chip>
        {(session.modalities?.primary ?? []).map((m: string) => (
          <Chip key={m}>{m}</Chip>
        ))}
        {caps.map((c) => (
          <Chip key={c} tone="good" title={`capability: ${c}`}>
            {CAP_LABEL[c] ?? c} ✓
          </Chip>
        ))}
        {session.bads.length > 0 && (
          <Chip tone="alert" title={session.bads.join(", ")}>
            {session.bads.length} bad
          </Chip>
        )}
      </div>

      <button
        onClick={onNewSession}
        className="flex h-full items-center gap-1.5 border-l border-seam px-3 text-sm text-fg-dim transition-colors hover:bg-panel-2 hover:text-fg"
      >
        <FolderOpen size={13} /> <span className="max-[1000px]:hidden">New session</span>
      </button>
      <button
        onClick={() => openSettings(true)}
        aria-label="Settings"
        className={clsx("flex h-full items-center border-l border-seam px-3 text-fg-dim transition-colors hover:bg-panel-2 hover:text-fg")}
      >
        <Settings2 size={15} />
      </button>
    </div>
  );
}
