import { useMemo, useState } from "react";
import { CommandBar } from "./CommandBar";
import { ContainerRail } from "./ContainerRail";
import { Inspector } from "./Inspector";
import { ProvenanceStrip } from "./ProvenanceStrip";
import { CardCanvas } from "../cards/CardCanvas";
import { PRESETS, defaultCards } from "../cards/registry";
import { useStore } from "../../store/store";

/**
 * The v2 shell: command bar (top) · container rail + card canvas + inspector
 * (middle) · transport + provenance (bottom). Replaces Terminal.tsx + Toolbar.
 */
export function Workspace({ onNewSession }: { onNewSession: () => void }) {
  const active = useStore((s) => s.activeContainerId);
  // per-container card list; unset = use the container's first preset
  const [layouts, setLayouts] = useState<Record<string, string[]>>({});

  const cards = useMemo(() => layouts[active] ?? defaultCards(active), [layouts, active]);

  // which preset (if any) the current card list matches
  const presetIdx = useMemo(() => {
    const presets = PRESETS[active] ?? [];
    return presets.findIndex((p) => p.cards.length === cards.length && p.cards.every((c, i) => c === cards[i]));
  }, [active, cards]);

  const applyPreset = (i: number) => {
    const preset = PRESETS[active]?.[i];
    if (preset) setLayouts((l) => ({ ...l, [active]: [...preset.cards] }));
  };
  const addCard = (id: string) => setLayouts((l) => ({ ...l, [active]: [...(l[active] ?? cards), id] }));
  const removeCard = (id: string) =>
    setLayouts((l) => ({ ...l, [active]: (l[active] ?? cards).filter((c) => c !== id) }));

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-bg">
      <CommandBar cards={cards} onAddCard={addCard} onNewSession={onNewSession} />
      <div className="flex min-h-0 flex-1">
        <ContainerRail presetIdx={presetIdx} onPreset={applyPreset} />
        <div className="min-w-0 flex-1">
          <CardCanvas cardIds={cards} onRemove={removeCard} />
        </div>
        <Inspector />
      </div>
      <ProvenanceStrip />
    </div>
  );
}
