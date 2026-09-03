import { Panel } from "../panels/Panel";
import { RenderedImage } from "./RenderedImage";
import { useStore } from "../../store/store";
import { useSignatureKey } from "../../store/useSignatureKey";

export function SensorsCard() {
  const session = useStore((s) => s.session);
  const sigKey = useSignatureKey();
  if (!session) return <Panel title="Sensors"><div /></Panel>;

  if (!session.has_montage) {
    return (
      <Panel title="Sensors">
        <div className="flex h-full items-center justify-center p-6 text-center text-xs text-fg-faint">
          No montage — run <span className="mono mx-1 text-fg-dim">Set montage</span> to place electrodes.
        </div>
      </Panel>
    );
  }
  return (
    <Panel title="Sensors" fkey="F2">
      <RenderedImage
        spec={{ view: "sensors", width: 420, height: 420 }}
        deps={[sigKey]}
        alt="sensor layout"
      />
    </Panel>
  );
}
