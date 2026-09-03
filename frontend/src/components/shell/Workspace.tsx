import { useMemo, useState } from "react";
import { CommandBar } from "./CommandBar";
import { ContainerRail } from "./ContainerRail";
import { Inspector } from "./Inspector";
import { ProvenanceStrip } from "./ProvenanceStrip";
import { WorkstationLayout } from "./WorkstationLayout";
import { CardCanvas } from "../cards/CardCanvas";
import { PRESETS, defaultCards } from "../cards/registry";
import { useStore } from "../../store/store";

/**
 * The v2 shell: command bar (top) · container rail + main area + inspector
 * (middle) · provenance (bottom). The main area is either the fixed
 * "Workstation" layout (raw, default) or the modular card grid.
 */
export function Workspace({ onNewSession }: { onNewSession: () => void }) {
  const active = useStore((s) => s.activeContainerId);
  const [layouts, setLayouts] = useState<Record<string, string[]>>({});
  const [presetByContainer, setPresetByContainer] = useState<Record<string, number>>({});

  const presets = PRESETS[active] ?? [];
  const presetIdx = presetByContainer[active] ?? 0;
  const preset = presets[presetIdx];
  const isWorkstation = preset?.layout === "workstation";

  const cards = useMemo(
    () => layouts[active] ?? preset?.cards ?? defaultCards(active),
    [layouts, active, preset],
  );

  const applyPreset = (i: number) => {
    setPresetByContainer((p) => ({ ...p, [active]: i }));
    const pr = PRESETS[active]?.[i];
    if (pr) setLayouts((l) => ({ ...l, [active]: [...pr.cards] }));
  };
  const addCard = (id: string) => setLayouts((l) => ({ ...l, [active]: [...(l[active] ?? cards), id] }));
  const removeCard = (id: string) =>
    setLayouts((l) => ({ ...l, [active]: (l[active] ?? cards).filter((c) => c !== id) }));

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-bg">
      <CommandBar cards={isWorkstation ? [] : cards} onAddCard={addCard} onNewSession={onNewSession} />
      <div className="flex min-h-0 flex-1">
        <ContainerRail presetIdx={presetIdx} onPreset={applyPreset} />
        <div className="min-w-0 flex-1">
          {isWorkstation ? <WorkstationLayout /> : <CardCanvas cardIds={cards} onRemove={removeCard} />}
        </div>
        <Inspector />
      </div>
      <ProvenanceStrip />
    </div>
  );
}
