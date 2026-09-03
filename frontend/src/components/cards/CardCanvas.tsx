import { X } from "lucide-react";
import { CARD_BY_ID } from "./registry";

/**
 * The modular canvas — a responsive grid of view-cards. Cards declare a grid
 * span; below the responsive floor everything collapses to one column. Each
 * card has a hover-reveal remove control. (Drag-resize is a P1.1 follow-up.)
 */
export function CardCanvas({
  cardIds,
  onRemove,
}: {
  cardIds: string[];
  onRemove: (id: string) => void;
}) {
  if (cardIds.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-fg-faint">
        No cards — add one from the <span className="mono mx-1">＋</span> menu.
      </div>
    );
  }
  return (
    <div
      className="grid h-full min-h-0 auto-rows-[minmax(200px,1fr)] gap-1.5 overflow-auto p-1.5
                 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]
                 max-[900px]:[grid-template-columns:1fr] max-[900px]:auto-rows-[280px]"
    >
      {cardIds.map((id) => {
        const def = CARD_BY_ID[id];
        if (!def) return null;
        const Comp = def.Component;
        return (
          <div
            key={id}
            className="group relative min-h-0 min-w-0 overflow-hidden rounded-sm border border-seam
                       max-[900px]:!col-auto max-[900px]:!row-auto"
            style={{
              gridColumn: def.span?.col ? `span ${def.span.col}` : undefined,
              gridRow: def.span?.row ? `span ${def.span.row}` : undefined,
            }}
          >
            <Comp />
            <button
              onClick={() => onRemove(id)}
              title="Remove card"
              className="absolute right-1 top-1 z-10 hidden rounded-xs bg-panel/80 p-0.5 text-fg-faint
                         hover:text-fg group-hover:block"
            >
              <X size={11} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
