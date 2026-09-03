import { useState } from "react";
import { Panel } from "../panels/Panel";
import { RenderedImage } from "./RenderedImage";
import { Segmented } from "../ui/primitives";
import { useStore } from "../../store/store";
import { useSignatureKey } from "../../store/useSignatureKey";

/** A real MNE topomap (server-rendered) — replaces v1's hand-rolled "Scalp field". */
export function TopographyCard() {
  const session = useStore((s) => s.session);
  const t = useStore((s) => s.t);
  const band = useStore((s) => s.band);
  const sigKey = useSignatureKey();
  const [mode, setMode] = useState<"cursor" | "band">("cursor");
  const tq = Math.round(t * 10) / 10;

  if (!session) return <Panel title="Topography"><div /></Panel>;
  if (!session.has_montage) {
    return (
      <Panel title="Topography">
        <div className="flex h-full items-center justify-center p-6 text-center text-xs text-fg-faint">
          No montage — run <span className="mono mx-1 text-fg-dim">Set montage</span> first.
        </div>
      </Panel>
    );
  }

  const spec =
    mode === "cursor"
      ? { view: "topomap", source: "cursor", t: tq, width: 360, height: 360 }
      : { view: "topomap", source: "band", band, width: 360, height: 360 };

  return (
    <Panel
      title="Topography"
      fkey="F2"
      right={
        <Segmented
          size="xs"
          value={mode}
          onChange={setMode}
          options={[
            { value: "cursor", label: "at cursor" },
            { value: "band", label: band },
          ]}
        />
      }
    >
      <RenderedImage
        spec={spec}
        deps={[sigKey, mode, mode === "cursor" ? tq : band]}
        alt="scalp topography"
      />
    </Panel>
  );
}
