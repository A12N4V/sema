import { useState } from "react";
import { RotateCcw, RotateCw } from "lucide-react";
import { Panel } from "../panels/Panel";
import { RenderedImage } from "./RenderedImage";
import { useStore } from "../../store/store";
import { useSignatureKey } from "../../store/useSignatureKey";

/**
 * 3D scalp field — a real head surface with the instantaneous EEG potential
 * interpolated across it (Perrin spherical spline), rendered server-side with
 * PyVista, cursor-linked. Not a cortical source estimate (that's the P6 wizard).
 */
export function Field3DCard() {
  const session = useStore((s) => s.session);
  const t = useStore((s) => s.t);
  const sigKey = useSignatureKey();
  const [az, setAz] = useState(-35);
  const tq = Math.round(t * 10) / 10;

  if (!session) return <Panel title="3D field"><div /></Panel>;
  if (!session.has_montage) {
    return (
      <Panel title="3D field">
        <div className="flex h-full items-center justify-center p-6 text-center text-xs text-fg-faint">
          No montage — run <span className="mono mx-1 text-fg-dim">Set montage</span> to place electrodes.
        </div>
      </Panel>
    );
  }

  return (
    <Panel
      title="3D scalp field"
      right={
        <div className="flex items-center gap-1">
          <button className="rounded px-0.5 text-fg-dim hover:text-fg" title="rotate" onClick={() => setAz((a) => a - 30)}><RotateCcw size={11} /></button>
          <button className="rounded px-0.5 text-fg-dim hover:text-fg" title="rotate" onClick={() => setAz((a) => a + 30)}><RotateCw size={11} /></button>
        </div>
      }
    >
      <RenderedImage
        spec={{ view: "field3d", t: tq, azimuth: az, elevation: 16, width: 560, height: 500 }}
        deps={[sigKey, tq, az]}
        alt="3D scalp field"
        debounceMs={180}
      />
    </Panel>
  );
}
